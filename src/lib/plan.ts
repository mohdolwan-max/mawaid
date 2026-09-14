import type { Lang } from "@/lib/i18n";

// Plan presentation only. Every NUMBER — price, staff limit, SMS
// allowance, featuring — lives in the `plans` table (0043) and reaches the
// app through list_plans / my_plan_usage. One source, so the pricing page,
// the dashboard and the database's own enforcement cannot drift apart.
// Free of React and the database so it can be tested directly.

export type PlanId = "free" | "basic" | "pro";

export type Plan = {
  id: PlanId;
  sort: number;
  /** null = unlimited */
  maxStaff: number | null;
  smsPerMonth: number;
  priceMonthJod: number;
  priceYearJod: number;
  featured: boolean;
};

export type PlanUsage = {
  /** The plan that applies now — a paid plan past expiry is "free". */
  planId: PlanId;
  /** What the org was set to, so an expired plan can be named. */
  storedPlanId: PlanId;
  expiresAt: string | null;
  expired: boolean;
  seatsUsed: number;
  maxStaff: number | null;
  smsPerMonth: number;
  featured: boolean;
};

const NAMES: Record<PlanId, Record<Lang, string>> = {
  free: { ar: "المجانية", en: "Free" },
  basic: { ar: "الأساسية", en: "Basic" },
  pro: { ar: "الاحترافية", en: "Pro" },
};

export function isPlanId(v: unknown): v is PlanId {
  return v === "free" || v === "basic" || v === "pro";
}

export function planName(id: PlanId, lang: Lang): string {
  return NAMES[id]?.[lang] ?? id;
}

/** Whole dinars print bare ("19"); fractions keep two places ("18.50").
 *  Western digits, matching every other price in the app. */
export function formatJod(n: number): string {
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** How many monthly payments the yearly price saves — the "two months
 *  free" line. Derived from the two prices, never typed, so it follows
 *  the table. null when there is no saving to state. */
export function freeMonthsOnYearly(p: Pick<Plan, "priceMonthJod" | "priceYearJod">): number | null {
  const m = p.priceMonthJod;
  const y = p.priceYearJod;
  if (!Number.isFinite(m) || !Number.isFinite(y) || m <= 0 || y <= 0) return null;
  const months = Math.round((m * 12 - y) / m);
  return months > 0 ? months : null;
}

/** Arabic month count with real number agreement: شهر / شهرين / ٣ أشهر / ١١ شهراً. */
export function monthsLabel(n: number, lang: Lang): string {
  if (lang === "en") return n === 1 ? "1 month" : `${n} months`;
  if (n === 1) return "شهر";
  if (n === 2) return "شهرين";
  if (n >= 3 && n <= 10) return `${n} أشهر`;
  return `${n} شهراً`;
}

/** A WhatsApp chat with the sales number, pre-filled with the plan asked
 *  for. `digits` is the number already reduced to digits. */
export function upgradeWhatsappUrl(digits: string, planLabel: string, lang: Lang): string {
  const text =
    lang === "ar"
      ? `مرحباً، بدي أرقّي عيادتي لباقة ${planLabel} على موعد`
      : `Hi, I'd like to upgrade my clinic to the ${planLabel} plan on Maw3ed`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
