import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isPlanId } from "@/lib/plan";
import {
  isBillingPeriod,
  isPaymentStatus,
  type Mandate,
  type PaymentRecord,
  type PurchaseOption,
} from "@/lib/billing";

function logRpcError(name: string, error: { code?: string }) {
  if (error.code === "PGRST202") {
    console.error(`${name} missing (0047 unapplied)`);
  } else {
    console.error(`${name} failed`, error);
  }
}

type OptionRow = {
  plan_id: string;
  period: string;
  amount_jod: number | string;
  starts_at: string;
  ends_at: string;
  credit_days: number;
};

/** null when it cannot be read: no price or date is then shown at all. */
export async function getPurchaseOptions(): Promise<PurchaseOption[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("plan_purchase_options");
  if (error) {
    logRpcError("plan_purchase_options", error);
    return null;
  }
  const out: PurchaseOption[] = [];
  for (const r of (data as OptionRow[]) ?? []) {
    const amount = Number(r.amount_jod);
    if (!isPlanId(r.plan_id) || !isBillingPeriod(r.period) || !Number.isFinite(amount)) continue;
    out.push({
      planId: r.plan_id,
      period: r.period,
      amountJod: amount,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      creditDays: r.credit_days,
    });
  }
  return out;
}

type PaymentRow = {
  id: string;
  kind: string;
  plan_id: string | null;
  period: string | null;
  offer_title: string | null;
  amount_jod: number | string;
  status: string;
  outcome: string | null;
  plan_ends_at: string | null;
  is_renewal: boolean;
  created_at: string;
  paid_at: string | null;
};

export async function listMyPayments(): Promise<PaymentRecord[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_payments");
  if (error) {
    logRpcError("list_my_payments", error);
    return null;
  }
  return ((data as PaymentRow[]) ?? [])
    .filter((r) => isPaymentStatus(r.status) && (r.kind === "plan" || r.kind === "offer"))
    .map((r) => ({
      id: r.id,
      kind: r.kind as PaymentRecord["kind"],
      planId: isPlanId(r.plan_id) ? r.plan_id : null,
      period: isBillingPeriod(r.period) ? r.period : null,
      offerTitle: r.offer_title,
      amountJod: Number(r.amount_jod),
      status: r.status as PaymentRecord["status"],
      outcome: r.outcome,
      planEndsAt: r.plan_ends_at,
      isRenewal: r.is_renewal,
      createdAt: r.created_at,
      paidAt: r.paid_at,
    }));
}

type MandateRow = {
  plan_id: string;
  period: string;
  card_label: string | null;
  active: boolean;
  failures: number;
  last_error: string | null;
};

/** { mandate: null } = no saved card; null = could not be read. */
export async function getMyMandate(): Promise<{ mandate: Mandate | null } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_billing_mandate").maybeSingle();
  if (error) {
    logRpcError("my_billing_mandate", error);
    return null;
  }
  const r = data as MandateRow | null;
  if (!r) return { mandate: null };
  if (!isPlanId(r.plan_id) || !isBillingPeriod(r.period)) return null;
  return {
    mandate: {
      planId: r.plan_id,
      period: r.period,
      cardLabel: r.card_label,
      active: r.active,
      failures: r.failures,
      lastError: r.last_error,
    },
  };
}
