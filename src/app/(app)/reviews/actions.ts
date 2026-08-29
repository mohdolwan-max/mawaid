"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";

export async function hideReview(reviewId: string) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("hide_review", { p_review_id: reviewId });
  if (error) throw error;
  revalidatePath("/reviews");
  revalidatePath(`/${ctx.slug}`);
}

export async function unhideReview(reviewId: string) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("unhide_review", { p_review_id: reviewId });
  if (error) throw error;
  revalidatePath("/reviews");
  revalidatePath(`/${ctx.slug}`);
}
