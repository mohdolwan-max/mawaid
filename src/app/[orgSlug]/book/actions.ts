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
import { issueBookingTicket } from "@/lib/bookingTicket";
import { createClient } from "@/lib/supabase/server";
import { phoneGate, resendPhoneCode, type GateError } from "@/lib/phoneGate";
import { markBookingSource } from "@/lib/bookingSource";
import { isBookingSource } from "@/lib/qr";
import { checkWaitlistForm } from "@/lib/waitlist";

/** The booking's answer. Beside BookResult: "a code was sent, ask for it"
 *  — the booking has not happened yet, and happens on the next submit
 *  that carries the code (0058). */
export type SubmitResult =
  | BookResult
  | { ok: false; error: "verify_required"; verify: { id: string; resendAfter: number } };

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
  /** The code the customer typed, for the verification the previous
   *  submit opened. */
  verification?: { id: string; code: string } | null;
  /** Where the visit started (0060): "qr" when the clinic page was opened
   *  from its QR code. Checked against the known sources, never trusted. */
  source?: string | null;
}): Promise<SubmitResult> {
  let sourceHash: string | null = null;
  try {
    sourceHash = await currentSourceHash();
  } catch (e) {
    console.error("currentSourceHash threw", e);
  }

  // The number must be a real one, proven by a code sent to it, once per
  // device (owner, 2026-09-29; src/lib/phoneGate.ts). Before the source
  // ceiling below: sending a code is not a booking attempt, and must not
  // spend one of the customer's.
  const gate = await phoneGate({
    orgSlug: input.orgSlug,
    phone: input.customerPhone,
    sourceHash,
    verification: input.verification ?? null,
  });
  if (!gate.pass) {
    return "verify" in gate
      ? { ok: false, error: "verify_required", verify: gate.verify }
      : { ok: false, error: gate.error };
  }

  // Bulk-abuse ceiling, before anything is written. Keyed on the request
  // source rather than on the phone, because the per-phone limit (0027)
  // resets the moment a digit changes — see 0040.
  //
  // FAIL OPEN, deliberately: if the guard itself errors — RPC missing
  // because 0040 is not applied yet, a network blip — the booking still
  // goes through. A broken doorman must not close the shop.
  try {
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

  // The ceiling that cannot be walked around (0051): the database only
  // accepts a public booking that carries a ticket, and only this server
  // can mint one. Spent on first use, so a refused attempt costs the same
  // as a successful booking.
  const ticket = await issueBookingTicket(input.orgSlug, sourceHash);
  if (!ticket.ok) {
    return { ok: false, error: ticket.error };
  }

  const result = await bookAppointmentChain({
    ticket: ticket.ticket,
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

  // Counted for the clinic's report; never able to fail the booking.
  if (result.ok && isBookingSource(input.source)) {
    await markBookingSource(result.cancelToken, input.source);
  }

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

export async function resendCodeAction(input: {
  orgSlug: string;
  customerPhone: string;
  verificationId: string;
}): Promise<{ ok: true; resendAfter: number } | { ok: false; error: GateError }> {
  return resendPhoneCode({
    orgSlug: input.orgSlug,
    phone: input.customerPhone,
    verificationId: input.verificationId,
  });
}

// ---- The waitlist (0066) ------------------------------------------------------

export type WaitlistJoinError =
  | "wl_err_name"
  | "wl_err_phone"
  | "wl_err_email"
  | "wl_err_day"
  | "wl_err_limit"
  | "error_generic";

/** No free time on the day the customer wants: leave a name and number,
 *  and be emailed (or called by the clinic) when a time is given up. Only
 *  this server can add to the list (booking secret), and the database
 *  caps it per number and per visitor. */
export async function joinWaitlistAction(input: {
  orgSlug: string;
  serviceIds: string[];
  staffId: string | null;
  day: string;
  name: string;
  phone: string;
  email: string;
  /** The booking form's honeypot field; a filled one is a bot. */
  website?: string;
}): Promise<{ ok: true } | { ok: false; error: WaitlistJoinError }> {
  const formError = checkWaitlistForm(input);
  if (formError) return { ok: false, error: formError };
  // A bot is told it worked and nothing is stored.
  if (input.website && input.website.trim() !== "") return { ok: true };
  const secret = process.env.BOOKING_SECRET;
  if (!secret) return { ok: false, error: "error_generic" };

  let sourceHash: string | null = null;
  try {
    sourceHash = await currentSourceHash();
  } catch (e) {
    console.error("currentSourceHash threw", e);
  }
  const lang = await getLang();
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_waitlist", {
    p_secret: secret,
    p_org_slug: input.orgSlug,
    p_service_ids: input.serviceIds,
    p_staff_id: input.staffId,
    p_day: input.day,
    p_name: input.name.trim(),
    p_phone: input.phone,
    p_email: input.email.trim() || null,
    p_lang: lang,
    p_source_hash: sourceHash,
  });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("waitlist_bad_day")) return { ok: false, error: "wl_err_day" };
    if (m.includes("waitlist_limit")) return { ok: false, error: "wl_err_limit" };
    if (m.includes("waitlist_phone")) return { ok: false, error: "wl_err_phone" };
    if (m.includes("waitlist_email")) return { ok: false, error: "wl_err_email" };
    if (m.includes("waitlist_name")) return { ok: false, error: "wl_err_name" };
    console.error("join_waitlist failed", error);
    return { ok: false, error: "error_generic" };
  }
  return { ok: true };
}
