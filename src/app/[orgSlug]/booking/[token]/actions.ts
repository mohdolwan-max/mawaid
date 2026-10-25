"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { sendWaitlistNotices } from "@/lib/waitlistNotify";
import {
  cancelVisitByToken,
  getAvailableSlotsChain,
  rescheduleByToken,
  type RescheduleResult,
} from "@/lib/availability";
import { submitReview } from "@/lib/reviews";

// Cancels every appointment in the visit. A guest booking three services
// holds exactly one link, so cancelling only the row that link points at
// left the other two on the clinic's calendar.
//
// A cancelled time may be what someone on the waitlist is waiting for
// (0066): they are emailed after the answer has gone back.
export async function cancelAction(token: string): Promise<boolean> {
  const ok = await cancelVisitByToken(token);
  if (ok) after(sendWaitlistNotices);
  return ok;
}

export async function submitReviewAction(
  token: string,
  rating: number,
  comment: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await submitReview(token, rating, comment.trim() || null);
  if (result.ok) revalidatePath("/my");
  return result;
}

// The picker deliberately calls the same availability RPC the customer
// used when booking, rather than a reschedule-specific one, so "what is
// available" can never mean two different things.
// Every service in the visit, not just the first: since 0053 the whole
// visit moves together, so the times offered must be the ones where ALL
// of it fits.
export async function fetchRescheduleSlotsAction(
  orgSlug: string,
  serviceIds: string[],
  date: string,
  staffId: string | null
): Promise<string[]> {
  return getAvailableSlotsChain(orgSlug, serviceIds, date, staffId);
}

export async function rescheduleAction(
  token: string,
  startAt: string
): Promise<RescheduleResult> {
  const result = await rescheduleByToken(token, startAt);
  // The old time is free now (0066).
  if (result.ok) after(sendWaitlistNotices);
  return result;
}
