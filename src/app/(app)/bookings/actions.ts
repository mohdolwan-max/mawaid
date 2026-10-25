"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { sendWaitlistNotices } from "@/lib/waitlistNotify";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";
import {
  bookAppointment,
  getAvailableSlots,
  rescheduleById,
  type BookResult,
  type RescheduleResult,
} from "@/lib/availability";
import type { BookingStatus } from "@/lib/types";
import { parseVisitPackageState, type VisitPackageState } from "@/lib/packages";

// Reports what happened. Firing the update and revalidating regardless
// made a refused write (RLS, a closed clinic, a stale row) look like a
// completed one: the row simply came back unchanged. Audit 2026-09-20.
//
// A visit marked completed may have drawn a session from the customer's
// package (0064's trigger); the answer says which, so the desk can tell
// the customer what is left. A failure to read that is not a failure of
// the status change, so it only drops the note.
export async function setBookingStatus(
  id: string,
  status: BookingStatus
): Promise<{ ok: true; package: VisitPackageState | null } | { ok: false; message: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
  if (error) {
    console.error("setBookingStatus failed", error);
    return { ok: false, message: error.message };
  }
  let pkg: VisitPackageState | null = null;
  if (status === "completed") {
    const { data, error: pkgError } = await supabase.rpc("visit_package_state", { p_appointment_id: id });
    if (pkgError && pkgError.code !== "PGRST202") console.error("visit_package_state failed", pkgError);
    pkg = pkgError ? null : parseVisitPackageState(data);
  }
  // A cancelled time may be what the waitlist is waiting for (0066).
  if (status === "cancelled") after(sendWaitlistNotices);
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
  revalidatePath("/calendar");
  revalidatePath("/waitlist");
  return { ok: true, package: pkg };
}

// Same availability source the customer booking page uses, so the owner
// picks from real bookable slots instead of typing a time and finding out
// from an error that it is outside business hours or already taken.
export async function fetchOwnerSlotsAction(
  serviceId: string,
  date: string,
  staffId: string | null
): Promise<string[]> {
  const ctx = await requireOrgContext();
  return getAvailableSlots(ctx.slug, serviceId, date, staffId);
}

export async function addManualBooking(input: {
  serviceId: string;
  staffId: string | null;
  startAt: string; // a real UTC instant, straight from get_available_slots
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  notes: string;
  // book_appointment() (0026) refuses a second booking overlapping one the
  // same phone already holds. Reception hits that legitimately — one number
  // books the whole family, so a mother putting two children with two
  // doctors at 3pm is a real request, not a mistake. Without a way through,
  // the only person who can serve that call is stuck.
  allowOverlap?: boolean;
}): Promise<BookResult> {
  const ctx = await requireOrgContext();

  const result = await bookAppointment({
    // A clinic member is exempt from the public ticket (0051).
    ticket: null,
    orgSlug: ctx.slug,
    serviceId: input.serviceId,
    startAt: input.startAt,
    staffId: input.staffId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail || null,
    notes: input.notes || null,
    allowOverlap: input.allowOverlap,
  });

  revalidatePath("/bookings");
  revalidatePath("/dashboard");
  return result;
}

// Reception moving an appointment. Goes through the same validation the
// customer's own reschedule uses (0030 _reschedule), so a clinic cannot
// accidentally park a booking outside its own opening hours.
export async function rescheduleBookingAction(
  appointmentId: string,
  startAt: string
): Promise<RescheduleResult> {
  await requireOrgContext();
  const result = await rescheduleById(appointmentId, startAt);
  if (result.ok) {
    // The old time is free now (0066).
    after(sendWaitlistNotices);
    revalidatePath("/waitlist");
    revalidatePath("/calendar");
    revalidatePath("/bookings");
    revalidatePath("/dashboard");
  }
  return result;
}
