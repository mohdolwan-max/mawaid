import type { Lang } from "@/lib/i18n";
import type { PlanId } from "@/lib/plan";

// Payments (0047, 0048): shapes and presentation. Every amount and every
// date a clinic is shown before paying comes from the database
// (plan_purchase_options), the same rule confirm_payment applies, so the
// screen and the charge cannot disagree. Every amount travels with its
// currency: a number alone is not a price once there is more than one
// country. Free of React and the database so it can be tested directly.

export type BillingPeriod = "month" | "year";

/** "refunded" (0049): money returned through the gateway, recorded by an admin. */
export type PaymentStatus = "pending" | "paid" | "failed" | "cancelled" | "needs_refund" | "refunded";

export type PurchaseOption = {
  planId: PlanId;
  period: BillingPeriod;
  amount: number;
  /** ISO 4217, e.g. "JOD". */
  currency: string;
  startsAt: string;
  endsAt: string;
  /** Whole days carried over from the current plan's unused paid days. */
  creditDays: number;
};

export type PaymentRecord = {
  id: string;
  kind: "plan" | "offer";
  planId: PlanId | null;
  period: BillingPeriod | null;
  offerTitle: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  outcome: string | null;
  planEndsAt: string | null;
  isRenewal: boolean;
  createdAt: string;
  paidAt: string | null;
};

export type Mandate = {
  planId: PlanId;
  period: BillingPeriod;
  cardLabel: string | null;
  active: boolean;
  failures: number;
  lastError: string | null;
};

export function isBillingPeriod(v: unknown): v is BillingPeriod {
  return v === "month" || v === "year";
}

// A status missing here would silently drop those rows from the history
// list (billingServer filters on it), so every database status is listed.
const STATUSES: readonly PaymentStatus[] = ["pending", "paid", "failed", "cancelled", "needs_refund", "refunded"];

export function isPaymentStatus(v: unknown): v is PaymentStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

/** A three-letter currency code, upper-cased; null for anything else. */
export function normalizeCurrency(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const code = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, "good" | "warn" | "bad" | "neutral"> = {
  paid: "good",
  pending: "warn",
  failed: "bad",
  needs_refund: "bad",
  cancelled: "neutral",
  refunded: "neutral",
};

/** An amount with up to three decimals (JOD has fils), trailing zeros
 *  dropped: 19 -> "19", 1.25 -> "1.25", 0.125 -> "0.125". Empty for a
 *  value that is not a number, never "NaN". */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

const CURRENCY_LABELS: Record<string, Record<Lang, string>> = {
  JOD: { ar: "د.أ", en: "JOD" },
  SAR: { ar: "ر.س", en: "SAR" },
  AED: { ar: "د.إ", en: "AED" },
  KWD: { ar: "د.ك", en: "KWD" },
  QAR: { ar: "ر.ق", en: "QAR" },
  BHD: { ar: "د.ب", en: "BHD" },
  OMR: { ar: "ر.ع", en: "OMR" },
  EGP: { ar: "ج.م", en: "EGP" },
};

/** The code itself for a currency without a local label, never blank. */
export function currencyLabel(code: string, lang: Lang): string {
  return CURRENCY_LABELS[code.toUpperCase()]?.[lang] ?? code.toUpperCase();
}

export function formatPrice(amount: number, currency: string, lang: Lang): string {
  const n = formatAmount(amount);
  return n === "" ? "—" : `${n} ${currencyLabel(currency, lang)}`;
}

/** The option for one plan and period, or null when it is not for sale. */
export function pickOption(
  options: readonly PurchaseOption[],
  planId: PlanId,
  period: BillingPeriod
): PurchaseOption | null {
  return options.find((o) => o.planId === planId && o.period === period) ?? null;
}

/** The period to preselect: the one a saved card renews, else monthly. */
export function defaultPeriod(mandate: Mandate | null): BillingPeriod {
  return mandate?.period ?? "month";
}
