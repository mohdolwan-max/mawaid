import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BookingSource } from "@/lib/qr";

// Marks a booking that was just made with where it came from (0060), by
// its cancel token. Runs AFTER the booking has committed, so it must never
// throw: a booking that happened is never reported as failed because its
// count could not be recorded. Gated by BOOKING_SECRET like the ticket.
export async function markBookingSource(cancelToken: string, source: BookingSource): Promise<void> {
  const secret = process.env.BOOKING_SECRET;
  if (!secret) return;
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_booking_source", {
      p_secret: secret,
      p_cancel_token: cancelToken,
      p_source: source,
    });
    // PGRST202: 0060 not applied yet. The booking stands; only the count
    // is missing, and quietly so until the migration runs.
    if (error && error.code !== "PGRST202") console.error("set_booking_source failed", error);
  } catch (e) {
    console.error("set_booking_source threw", e);
  }
}
