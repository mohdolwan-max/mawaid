import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { publicSupabase } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { isPlanId, isPlanPhase, type Plan, type PlanTerms, type PlanUsage } from "@/lib/plan";

export const PLANS_TAG = "plans";

type PlanRow = {
  id: string;
  sort: number;
  max_staff: number | null;
  sms_per_month: number;
  price_month_jod: number | string;
  price_year_jod: number | string;
  featured: boolean;
};

// The same for every visitor and changed by hand in SQL, so five minutes
// of cache is plenty — a price edit shows within that window.
const cachedPlans = unstable_cache(
  async (): Promise<Plan[]> => {
    const { data, error } = await publicSupabase.rpc("list_plans");
    if (error) {
      if (error.code === "PGRST202") {
        console.error("list_plans missing (0043 unapplied)");
      } else {
        console.error("list_plans failed", error);
      }
      // Thrown, not returned as []: a failure must not be cached as
      // "there are no plans".
      throw error;
    }
    return ((data as PlanRow[]) ?? [])
      .filter((r) => isPlanId(r.id))
      .map((r) => ({
        id: r.id as Plan["id"],
        sort: r.sort,
        maxStaff: r.max_staff,
        smsPerMonth: r.sms_per_month,
        priceMonthJod: Number(r.price_month_jod),
        priceYearJod: Number(r.price_year_jod),
        featured: r.featured,
      }));
  },
  ["list-plans"],
  { revalidate: 300, tags: [PLANS_TAG] }
);

/** null when the plans cannot be loaded — the pricing section then shows
 *  no prices at all rather than invented ones. */
export async function listPlans(): Promise<Plan[] | null> {
  try {
    const plans = await cachedPlans();
    return plans.length > 0 ? plans : null;
  } catch {
    return null;
  }
}

const cachedTerms = unstable_cache(
  async (): Promise<PlanTerms> => {
    const { data, error } = await publicSupabase.rpc("get_plan_terms").maybeSingle();
    if (error) {
      if (error.code === "PGRST202") {
        console.error("get_plan_terms missing (0046 unapplied)");
      } else {
        console.error("get_plan_terms failed", error);
      }
      throw error;
    }
    const r = data as { trial_days: number; grace_days: number } | null;
    if (!r || !Number.isInteger(r.trial_days) || !Number.isInteger(r.grace_days)) {
      throw new Error("plan_settings row missing");
    }
    return { trialDays: r.trial_days, graceDays: r.grace_days };
  },
  ["plan-terms"],
  { revalidate: 300, tags: [PLANS_TAG] }
);

/** null when unknown — the trial is then not promised with a number. */
export async function getPlanTerms(): Promise<PlanTerms | null> {
  try {
    return await cachedTerms();
  } catch {
    return null;
  }
}

type UsageRow = {
  plan_id: string;
  is_trial: boolean;
  expires_at: string | null;
  open_until: string | null;
  phase: string;
  seats_used: number;
  max_staff: number | null;
  sms_per_month: number;
  featured: boolean;
};

/** The signed-in member's plan, where it stands, and seat usage. null when
 *  it cannot be read — the dashboard then hides the card and the notice
 *  rather than printing "0 of 1" or a wrong end date.
 *  cache(): the (app) layout and the dashboard ask in the same render. */
export const getMyPlanUsage = cache(async (): Promise<PlanUsage | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_plan_usage").maybeSingle();
  if (error) {
    if (error.code !== "PGRST202") console.error("my_plan_usage failed", error);
    return null;
  }
  const r = data as UsageRow | null;
  // Before 0046 the row has no phase; hide rather than guess one.
  if (!r || !isPlanId(r.plan_id) || !isPlanPhase(r.phase)) return null;
  return {
    planId: r.plan_id,
    isTrial: r.is_trial,
    expiresAt: r.expires_at,
    openUntil: r.open_until,
    phase: r.phase,
    seatsUsed: r.seats_used,
    maxStaff: r.max_staff,
    smsPerMonth: r.sms_per_month,
    featured: r.featured,
  };
});
