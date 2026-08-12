"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";
import { bookAppointment, type BookResult } from "@/lib/availability";
import type { BookingStatus } from "@/lib/types";

export async function setBookingStatus(id: string, status: BookingStatus) {
  const supabase = await createClient();
  await supabase.from("appointments").update({ status }).eq("id", id);
  revalidatePath("/bookings");
  revalidatePath("/dashboard");
}

export async function addManualBooking(input: {
  serviceId: string;
  staffId: string | null;
  startAtLocal: string; // "YYYY-MM-DDTHH:mm", interpreted in the org's own timezone
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  notes: string;
}): Promise<BookResult> {
  const ctx = await requireOrgContext();

  // Convert the wall-clock local input into a UTC instant using the org's
  // own timezone (ctx.timezone, already loaded by requireOrgContext()).
  const startAtIso = localWallClockToIso(input.startAtLocal, ctx.timezone);

  const result = await bookAppointment({
    orgSlug: ctx.slug,
    serviceId: input.serviceId,
    startAt: startAtIso,
    staffId: input.staffId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail || null,
    notes: input.notes || null,
  });

  revalidatePath("/bookings");
  revalidatePath("/dashboard");
  return result;
}

// Interprets a "YYYY-MM-DDTHH:mm" string as wall-clock time in `tz` and
// returns the equivalent UTC ISO instant. Using the offset of "now" in
// that timezone is a good-enough approximation for the handful of
// timezones this app targets (no DST transitions mid-scheduling-window).
function localWallClockToIso(local: string, tz: string): string {
  const [datePart, timePart] = local.split("T");
  const asUtcGuess = new Date(`${datePart}T${timePart}:00Z`);
  const tzOffsetLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  })
    .formatToParts(asUtcGuess)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = tzOffsetLabel?.match(/GMT([+-]\d+)(?::(\d+))?/);
  const offsetHours = match ? Number(match[1]) : 0;
  const offsetMinutes = match?.[2] ? Number(match[2]) : 0;
  const totalOffsetMs = (offsetHours * 60 + Math.sign(offsetHours || 1) * offsetMinutes) * 60 * 1000;
  return new Date(asUtcGuess.getTime() - totalOffsetMs).toISOString();
}
