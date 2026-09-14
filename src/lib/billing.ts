import type { PlanId } from "@/lib/plan";

// Payments (0047): shapes and presentation. Every amount and every date a
// clinic is shown before paying comes from the database
// (plan_purchase_options), the same rule confirm_payment applies, so the
// screen and the charge cannot disagree. Free of React and the database so
// it can be tested directly.

export type BillingPeriod = "month" | "year";

export type PaymentStatus = "pending" | "paid" | "failed" | "cancelled" | "needs_refund";

export type PurchaseOption = {
  planId: PlanId;
  period: BillingPeriod;
  amountJod: number;
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
  amountJod: number;
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

const STATUSES: readonly PaymentStatus[] = ["pending", "paid", "failed", "cancelled", "needs_refund"];

export function isPaymentStatus(v: unknown): v is PaymentStatus {
  return typeof v === "string" && (STATUSES as readonly string[]).includes(v);
}

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, "good" | "warn" | "bad" | "neutral"> = {
  paid: "good",
  pending: "warn",
  failed: "bad",
  needs_refund: "bad",
  cancelled: "neutral",
};

/** A dinar amount with up to three decimals (fils), trailing zeros
 *  dropped: 19 -> "19", 1.25 -> "1.25", 0.125 -> "0.125". Empty for a
 *  value that is not a number, never "NaN". */
export function formatAmountJod(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
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
