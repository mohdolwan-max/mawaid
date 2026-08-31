"use server";

import { revalidatePath } from "next/cache";
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

export async function setBookingStatus(id: string, status: BookingStatus) {
  const supabase = await createClient();
  await supabase.from("appointments").update({ status }).eq("id", id);
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
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
    revalidatePath("/calendar");
    revalidatePath("/bookings");
    revalidatePath("/dashboard");
  }
  return result;
}
