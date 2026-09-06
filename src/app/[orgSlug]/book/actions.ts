"use server";

import {
  getAvailableSlotsChain,
  bookAppointmentChain,
  type BookResult,
} from "@/lib/availability";
import { listPublicStaffForService, listPublicServices, getPublicOrg, type PublicStaff } from "@/lib/publicOrg";
import { sendBookingConfirmation } from "@/lib/email";
import { getLang } from "@/lib/lang";
import { currentSourceHash } from "@/lib/sourceLimit";
import { createClient } from "@/lib/supabase/server";

export async function fetchStaffAction(orgSlug: string, serviceId: string): Promise<PublicStaff[]> {
  return listPublicStaffForService(orgSlug, serviceId);
}

export async function fetchSlotsAction(
  orgSlug: string,
  serviceIds: string[],
  date: string,
  staffId: string | null
): Promise<string[]> {
  return getAvailableSlotsChain(orgSlug, serviceIds, date, staffId);
}

export async function submitBookingAction(input: {
  orgSlug: string;
  serviceIds: string[];
  startAt: string;
  staffId: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  notes: string;
  allowOverlap?: boolean;
}): Promise<BookResult> {
  // Bulk-abuse ceiling, before anything is written. Keyed on the request
  // source rather than on the phone, because the per-phone limit (0027)
  // resets the moment a digit changes — see 0040. Nothing is asked of
  // the customer, so the honest path is untouched.
  //
  // FAIL OPEN, deliberately: if the guard itself errors — RPC missing
  // because 0040 is not applied yet, a network blip — the booking still
  // goes through. A broken doorman must not close the shop.
  try {
    const sourceHash = await currentSourceHash();
    const supabase = await createClient();
    const { error } = await supabase.rpc("check_booking_source", {
      p_source_hash: sourceHash,
    });
    if (error) {
      if (error.message?.includes("rate_limited")) {
        return { ok: false, error: "book_rate_limited" };
      }
      console.error("check_booking_source failed", error);
    }
  } catch (e) {
    console.error("check_booking_source threw", e);
  }

  const result = await bookAppointmentChain({
    orgSlug: input.orgSlug,
    serviceIds: input.serviceIds,
    startAt: input.startAt,
    staffId: input.staffId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail || null,
    notes: input.notes || null,
    allowOverlap: input.allowOverlap,
  });

  if (result.ok && input.customerEmail) {
    // Everything below runs AFTER book_appointment() has already
    // committed the row. sendBookingConfirmation() swallows its own
    // provider errors, but the lookups around it (and the
    // toLocaleString/timeZone formatting inside it) can still throw —
    // and a throw here would reject the whole Server Action, so the
    // customer would be told the booking failed while it actually
    // exists, and would very likely book a second time. Log and move
    // on: a missing confirmation email is far cheaper than a duplicate.
    try {
      const [org, services, lang] = await Promise.all([
        getPublicOrg(input.orgSlug),
        listPublicServices(input.orgSlug),
        getLang(),
      ]);
      // Name every service the visit actually booked, at its own time.
      // result.segments comes back from book_appointment_chain, which is
      // the only place that knows each segment's real start — durations
      // cannot be re-summed here because PublicService carries no buffer.
      const booked = result.segments
        .map((seg) => {
          const service = services.find((s) => s.id === seg.serviceId);
          return service ? { name: service.name, startAt: seg.startAt } : null;
        })
        .filter((s): s is { name: string; startAt: string } => s !== null);

      if (org && booked.length > 0) {
        await sendBookingConfirmation({
          toEmail: input.customerEmail,
          toName: input.customerName,
          orgName: org.name,
          services: booked,
          timezone: org.timezone,
          lang,
          manageUrl: `https://${process.env.NEXT_PUBLIC_SITE_HOST ?? "maw3ed.me"}/${input.orgSlug}/booking/${result.cancelToken}`,
        });
      }
    } catch (err) {
      console.error("Booking committed, but the confirmation email step failed", err);
    }
  }

  return result;
}
