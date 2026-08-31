import "server-only";
import { unstable_cache, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { publicSupabase } from "@/lib/supabase/public";
import { ORG_TAG } from "@/lib/publicOrg";

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
  // The rating shown on the clinic's card and profile is computed from
  // these rows, so both caches have to go the moment one lands.
  revalidateTag(ORG_TAG);
  return { ok: true };
}

const cachedOrgReviews = unstable_cache(
  async (orgSlug: string, limit: number): Promise<OrgReview[]> => {
    const { data, error } = await publicSupabase.rpc("get_org_reviews", {
      p_org_slug: orgSlug,
      p_limit: limit,
    });
    if (error) {
      console.error("get_org_reviews failed", error);
      throw error;
    }
    return (data as OrgReview[]) ?? [];
  },
  ["org-reviews"],
  { revalidate: 60, tags: [ORG_TAG] }
);

export async function getOrgReviews(orgSlug: string, limit = 10): Promise<OrgReview[]> {
  try {
    return await cachedOrgReviews(orgSlug, limit);
  } catch {
    // A clinic with no reviews and a clinic whose reviews failed to load
    // look the same on screen; the difference is in the log above.
    return [];
  }
}

const cachedRatingSummary = unstable_cache(
  async (orgSlug: string): Promise<RatingSummary> => {
    const { data, error } = await publicSupabase
      .rpc("get_org_rating_summary", { p_org_slug: orgSlug })
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      console.error("get_org_rating_summary failed", error);
      throw error;
    }
    const row = data as { avg_rating: number | null; review_count: number } | null;
    return { avg_rating: row?.avg_rating ?? null, review_count: row?.review_count ?? 0 };
  },
  ["org-rating-summary"],
  { revalidate: 60, tags: [ORG_TAG] }
);

export async function getOrgRatingSummary(orgSlug: string): Promise<RatingSummary> {
  try {
    return await cachedRatingSummary(orgSlug);
  } catch {
    // null, not 0 — "we could not read the rating" is not "no rating".
    // Every rating surface is already null-guarded.
    return { avg_rating: null, review_count: 0 };
  }
}
