import "server-only";
import { createClient } from "@/lib/supabase/server";

export type OrgReview = {
  rating: number;
  comment: string | null;
  customer_name: string;
  created_at: string;
};

export type RatingSummary = { avg_rating: number | null; review_count: number };

export async function canReview(token: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_review", { p_cancel_token: token });
  return Boolean(data);
}

export async function submitReview(
  token: string,
  rating: number,
  comment: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_review", {
    p_cancel_token: token,
    p_rating: rating,
    p_comment: comment,
  });
  if (error) return { ok: false, error: "error_generic" };
  return { ok: true };
}

export async function getOrgReviews(orgSlug: string, limit = 10): Promise<OrgReview[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_org_reviews", { p_org_slug: orgSlug, p_limit: limit });
  return (data as OrgReview[]) ?? [];
}

export async function getOrgRatingSummary(orgSlug: string): Promise<RatingSummary> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_org_rating_summary", { p_org_slug: orgSlug }).maybeSingle();
  const row = data as { avg_rating: number | null; review_count: number } | null;
  return { avg_rating: row?.avg_rating ?? null, review_count: row?.review_count ?? 0 };
}
