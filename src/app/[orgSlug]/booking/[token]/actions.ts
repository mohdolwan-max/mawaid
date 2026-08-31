"use server";

import { revalidatePath } from "next/cache";
import {
  cancelVisitByToken,
  getAvailableSlots,
  rescheduleByToken,
  type RescheduleResult,
} from "@/lib/availability";
import { submitReview } from "@/lib/reviews";

// Cancels every appointment in the visit. A guest booking three services
// holds exactly one link, so cancelling only the row that link points at
// left the other two on the clinic's calendar.
export async function cancelAction(token: string): Promise<boolean> {
  return cancelVisitByToken(token);
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
export async function fetchRescheduleSlotsAction(
  orgSlug: string,
  serviceId: string,
  date: string,
  staffId: string | null
): Promise<string[]> {
  return getAvailableSlots(orgSlug, serviceId, date, staffId);
}

export async function rescheduleAction(
  token: string,
  startAt: string
): Promise<RescheduleResult> {
  const result = await rescheduleByToken(token, startAt);
  return result;
}
