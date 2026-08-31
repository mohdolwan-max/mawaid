"use server";

import { revalidatePath } from "next/cache";
import { cancelVisitByToken } from "@/lib/availability";
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
