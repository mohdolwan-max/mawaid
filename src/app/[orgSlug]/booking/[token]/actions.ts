"use server";

import { revalidatePath } from "next/cache";
import { cancelBookingByToken } from "@/lib/availability";
import { submitReview } from "@/lib/reviews";

export async function cancelAction(token: string): Promise<boolean> {
  return cancelBookingByToken(token);
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
