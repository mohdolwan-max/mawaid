import type { Lang } from "@/lib/i18n";

// Plan presentation only. Every NUMBER — price, staff limit, SMS
// allowance, featuring, trial and grace length — lives in the database
// (plans 0043, plan_settings 0046) and reaches the app through list_plans
// / get_plan_terms / my_plan_usage. One source, so the pricing page, the
// dashboard and the database's own enforcement cannot drift apart.
// Free of React and the database so it can be tested directly.
//
// There is no free plan (0046): a clinic starts on a trial of basic, and
// a plan that ends has grace days before the clinic closes to the public.

export type PlanId = "basic" | "pro";

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

/** active: inside the plan or trial. grace: ended, the clinic still open
 *  for the grace days. lapsed: closed to the public until paid. */
export type PlanPhase = "active" | "grace" | "lapsed";

export type PlanUsage = {
  planId: PlanId;
  isTrial: boolean;
  /** When the plan or trial ends. null = no end. */
  expiresAt: string | null;
  /** When the grace days run out and the clinic closes. null = no end. */
  openUntil: string | null;
  phase: PlanPhase;
  seatsUsed: number;
  maxStaff: number | null;
  smsPerMonth: number;
  featured: boolean;
};

export type PlanTerms = { trialDays: number; graceDays: number };

const NAMES: Record<PlanId, Record<Lang, string>> = {
  basic: { ar: "الأساسية", en: "Basic" },
  pro: { ar: "الاحترافية", en: "Pro" },
};

export function isPlanId(v: unknown): v is PlanId {
  return v === "basic" || v === "pro";
}

export function isPlanPhase(v: unknown): v is PlanPhase {
  return v === "active" || v === "grace" || v === "lapsed";
}

/** Whole days left until an instant, a started day counting as one, so a
 *  plan ending in 3 hours says "1 day", never "0". Never negative. null
 *  when there is no end or it cannot be read. */
export function daysLeft(untilIso: string | null, nowMs: number): number | null {
  if (!untilIso || !Number.isFinite(nowMs)) return null;
  const until = Date.parse(untilIso);
  if (!Number.isFinite(until)) return null;
  return Math.max(0, Math.ceil((until - nowMs) / 86_400_000));
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

/** Arabic day count with number agreement: يوم / يومين / ٣ أيام / ١١ يوماً. */
export function daysLabel(n: number, lang: Lang): string {
  if (lang === "en") return n === 1 ? "1 day" : `${n} days`;
  if (n === 1) return "يوم";
  if (n === 2) return "يومين";
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يوماً`;
}

/** The sales number as wa.me needs it: international digits, no "+" and
 *  no "00". A number written the local way ("0505839366") has lost its
 *  country and wa.me cannot open it, so it is refused (null hides the
 *  upgrade buttons) rather than rendered as a link that goes nowhere. */
export function salesWhatsappDigits(raw: string | undefined): string | null {
  let digits = (raw ?? "").replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") || digits.length < 8 || digits.length > 15) return null;
  return digits;
}

/** A WhatsApp chat with the sales number, pre-filled with the plan asked
 *  for. `digits` comes from salesWhatsappDigits(). */
export function upgradeWhatsappUrl(
  digits: string,
  planLabel: string,
  lang: Lang,
  intent: "upgrade" | "subscribe" = "upgrade"
): string {
  const text =
    intent === "subscribe"
      ? lang === "ar"
        ? `مرحباً، بدي أشترك بباقة ${planLabel} لعيادتي على موعد`
        : `Hi, I'd like to subscribe my clinic to the ${planLabel} plan on Maw3ed`
      : lang === "ar"
        ? `مرحباً، بدي أرقّي عيادتي لباقة ${planLabel} على موعد`
        : `Hi, I'd like to upgrade my clinic to the ${planLabel} plan on Maw3ed`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
