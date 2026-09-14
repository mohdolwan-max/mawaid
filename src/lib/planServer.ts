import "server-only";
import { unstable_cache } from "next/cache";
import { publicSupabase } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { isPlanId, type Plan, type PlanUsage } from "@/lib/plan";

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

type UsageRow = {
  plan_id: string;
  stored_plan_id: string;
  expires_at: string | null;
  expired: boolean;
  seats_used: number;
  max_staff: number | null;
  sms_per_month: number;
  featured: boolean;
};

/** The signed-in member's plan and seat usage. null when it cannot be
 *  read — the dashboard hides the card rather than printing "0 of 1". */
export async function getMyPlanUsage(): Promise<PlanUsage | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_plan_usage").maybeSingle();
  if (error) {
    if (error.code !== "PGRST202") console.error("my_plan_usage failed", error);
    return null;
  }
  const r = data as UsageRow | null;
  if (!r || !isPlanId(r.plan_id) || !isPlanId(r.stored_plan_id)) return null;
  return {
    planId: r.plan_id,
    storedPlanId: r.stored_plan_id,
    expiresAt: r.expires_at,
    expired: r.expired,
    seatsUsed: r.seats_used,
    maxStaff: r.max_staff,
    smsPerMonth: r.sms_per_month,
    featured: r.featured,
  };
}
