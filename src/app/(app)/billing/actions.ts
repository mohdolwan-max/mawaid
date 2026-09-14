"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";
import { siteUrl } from "@/lib/siteUrl";
import { isPlanId, planName } from "@/lib/plan";
import { isBillingPeriod, isPaymentStatus, type PaymentStatus } from "@/lib/billing";
import { getPaymentProvider, paymentsDb, paymentsSecret } from "@/lib/payments";
import type { OrgContext } from "@/lib/types";

export type BillingActionError =
  | "billing_owner_only"
  | "billing_not_ready"
  | "billing_checkout_failed"
  | "billing_no_saved_card"
  | "offer_not_payable"
  | "error_generic";

function toActionError(name: string, error: { message: string }): BillingActionError {
  if (error.message.includes("not_authorized")) return "billing_owner_only";
  if (error.message.includes("offer_not_payable")) return "offer_not_payable";
  if (error.message.includes("no_saved_card")) return "billing_no_saved_card";
  console.error(`${name} failed`, error);
  return "error_generic";
}

const HOST_SHAPE = /^[a-z0-9.-]+(:\d{1,5})?$/i;

// The origin the gateway is told to call back and send the browser to.
// Built from the host this owner is actually on, not NEXT_PUBLIC_SITE_HOST:
// the configured apex (maw3ed.me) answers 308 -> www.maw3ed.me, and PayTabs
// requires a callback URL that responds directly, with no redirect. The
// host the owner loaded /billing from is, by definition, one that serves.
async function paymentOrigin(): Promise<string> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!HOST_SHAPE.test(host)) return siteUrl();
  const proto = host.startsWith("localhost") ? "http" : "https";
  return `${proto}://${host}`;
}

type CheckoutResult = { url: string } | { error: BillingActionError };

// The payment row exists before this runs; if the gateway cannot open a
// page for it, it is failed at once rather than left pending forever, with
// the gateway's own reason kept on the row for diagnosis.
async function openCheckout(
  ctx: OrgContext,
  payment: { id: string; amount: number; currency: string },
  description: string,
  saveCard: boolean
): Promise<CheckoutResult> {
  const provider = getPaymentProvider();
  const secret = paymentsSecret();
  if (!provider || !secret) return { error: "billing_not_ready" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const base = await paymentOrigin();

  try {
    const { redirectUrl } = await provider.createCheckout({
      paymentId: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      description,
      customerEmail: user?.email ?? null,
      customerName: ctx.name,
      saveCard,
      returnUrl: `${base}/api/payments/return?payment=${payment.id}`,
      webhookUrl: `${base}/api/payments/webhook`,
      lang: ctx.lang,
    });
    return { url: redirectUrl };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("checkout could not be created", { paymentId: payment.id, reason });
    await paymentsDb().rpc("fail_payment", {
      p_secret: secret,
      p_payment_id: payment.id,
      p_provider: provider.id,
      p_reason: `checkout_not_created: ${reason}`.slice(0, 300),
    });
    return { error: "billing_checkout_failed" };
  }
}

export async function startPlanCheckout(input: {
  planId: string;
  period: string;
  saveCard: boolean;
}): Promise<CheckoutResult> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "owner") return { error: "billing_owner_only" };
  if (!isPlanId(input.planId) || !isBillingPeriod(input.period)) return { error: "error_generic" };
  // Checked before a payment row is written, so an unconfigured gateway
  // leaves no pending rows behind.
  if (!getPaymentProvider() || !paymentsSecret()) return { error: "billing_not_ready" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("start_plan_payment", { p_plan: input.planId, p_period: input.period, p_save_card: input.saveCard })
    .single();
  if (error) return { error: toActionError("start_plan_payment", error) };

  const row = data as { payment_id: string; amount: number | string; currency: string };
  const period = input.period === "year" ? "yearly" : "monthly";
  return openCheckout(
    ctx,
    { id: row.payment_id, amount: Number(row.amount), currency: row.currency },
    `Maw3ed ${planName(input.planId, "en")} plan, ${period}`,
    input.saveCard
  );
}

export async function startOfferCheckout(offerId: string): Promise<CheckoutResult> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "owner") return { error: "billing_owner_only" };
  if (!getPaymentProvider() || !paymentsSecret()) return { error: "billing_not_ready" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_offer_payment", { p_offer_id: offerId }).single();
  if (error) return { error: toActionError("start_offer_payment", error) };

  const row = data as { payment_id: string; amount: number | string; currency: string };
  return openCheckout(
    ctx,
    { id: row.payment_id, amount: Number(row.amount), currency: row.currency },
    "Maw3ed offer banner",
    false
  );
}

export async function setAutoRenew(active: boolean): Promise<{ error?: BillingActionError }> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "owner") return { error: "billing_owner_only" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_auto_renew", { p_active: active });
  if (error) return { error: toActionError("set_auto_renew", error) };

  revalidatePath("/billing");
  return {};
}

export type PaymentStatusView = {
  status: PaymentStatus;
  kind: "plan" | "offer";
  planEndsAt: string | null;
};

export async function getPaymentStatus(
  paymentId: string
): Promise<{ payment: PaymentStatusView | null } | { error: BillingActionError }> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "owner") return { error: "billing_owner_only" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_payment", { p_payment_id: paymentId }).maybeSingle();
  if (error) return { error: toActionError("get_my_payment", error) };

  const r = data as { status: string; kind: string; plan_ends_at: string | null } | null;
  if (!r || !isPaymentStatus(r.status) || (r.kind !== "plan" && r.kind !== "offer")) return { payment: null };
  return { payment: { status: r.status, kind: r.kind, planEndsAt: r.plan_ends_at } };
}
