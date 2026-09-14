import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  currencyCodeOrNull,
  isClinicPhase,
  num,
  parseOverview,
  type AdminClinic,
  type AdminOffer,
  type AdminOverview,
  type AdminPayment,
  type MoneyByCurrency,
} from "@/lib/admin";

function logRpcError(name: string, error: { code?: string }) {
  if (error.code === "PGRST202") {
    console.error(`${name} missing (0049 unapplied)`);
  } else {
    console.error(`${name} failed`, error);
  }
}

/** false on any failure: a page that cannot confirm the caller is an
 *  admin shows nothing, never the admin page. cache(): the layout and a
 *  page ask in the same render. */
export const isPlatformAdmin = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) {
    logRpcError("is_platform_admin", error);
    return false;
  }
  return data === true;
});

export async function getAdminOverview(): Promise<AdminOverview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_overview");
  if (error) {
    logRpcError("admin_overview", error);
    return null;
  }
  return parseOverview(data);
}

function moneyMap(v: unknown): MoneyByCurrency {
  if (typeof v !== "object" || v === null) return [];
  const out: MoneyByCurrency = [];
  for (const [k, amount] of Object.entries(v as Record<string, unknown>)) {
    const currency = currencyCodeOrNull(k);
    const n = num(amount);
    if (currency && n !== null) out.push({ currency, amount: n });
  }
  return out;
}

type ClinicRow = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  category: string | null;
  plan: string;
  is_trial: boolean;
  plan_expires_at: string | null;
  phase: string;
  is_listed: boolean;
  is_demo: boolean;
  created_at: string;
  deleted_at: string | null;
  owner_email: string | null;
  services_count: number;
  bookings_30d: number;
  last_booking_at: string | null;
  paid_totals: unknown;
  auto_renew: boolean;
  card_label: string | null;
};

export async function listAdminClinics(): Promise<AdminClinic[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_clinics");
  if (error) {
    logRpcError("admin_clinics", error);
    return null;
  }
  return ((data as ClinicRow[]) ?? [])
    .filter((r) => isClinicPhase(r.phase))
    .map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      city: r.city,
      category: r.category,
      plan: r.plan,
      isTrial: r.is_trial,
      planExpiresAt: r.plan_expires_at,
      phase: r.phase as AdminClinic["phase"],
      isListed: r.is_listed,
      isDemo: r.is_demo,
      createdAt: r.created_at,
      deletedAt: r.deleted_at,
      ownerEmail: r.owner_email,
      servicesCount: r.services_count,
      bookings30d: r.bookings_30d,
      lastBookingAt: r.last_booking_at,
      paidTotals: moneyMap(r.paid_totals),
      autoRenew: r.auto_renew,
      cardLabel: r.card_label,
    }));
}

const PAYMENT_STATUSES = new Set(["pending", "paid", "failed", "cancelled", "needs_refund", "refunded"]);

type PaymentRow = {
  id: string;
  created_at: string;
  paid_at: string | null;
  org_id: string;
  org_name: string;
  org_slug: string;
  kind: string;
  plan_id: string | null;
  period: string | null;
  offer_title: string | null;
  amount: number | string;
  currency: string;
  status: string;
  outcome: string | null;
  failure_reason: string | null;
  provider: string | null;
  provider_ref: string | null;
  is_renewal: boolean;
  refunded_at: string | null;
  refund_note: string | null;
};

export async function listAdminPayments(): Promise<AdminPayment[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_payments");
  if (error) {
    logRpcError("admin_payments", error);
    return null;
  }
  const out: AdminPayment[] = [];
  for (const r of (data as PaymentRow[]) ?? []) {
    const currency = currencyCodeOrNull(r.currency);
    const amount = num(r.amount);
    if (!currency || amount === null || !PAYMENT_STATUSES.has(r.status) || (r.kind !== "plan" && r.kind !== "offer")) continue;
    out.push({
      id: r.id,
      createdAt: r.created_at,
      paidAt: r.paid_at,
      orgId: r.org_id,
      orgName: r.org_name,
      orgSlug: r.org_slug,
      kind: r.kind,
      planId: r.plan_id,
      period: r.period === "month" || r.period === "year" ? r.period : null,
      offerTitle: r.offer_title,
      amount,
      currency,
      status: r.status as AdminPayment["status"],
      outcome: r.outcome,
      failureReason: r.failure_reason,
      provider: r.provider,
      providerRef: r.provider_ref,
      isRenewal: r.is_renewal,
      refundedAt: r.refunded_at,
      refundNote: r.refund_note,
    });
  }
  return out;
}

type OfferRow = {
  id: string;
  org_id: string;
  org_name: string;
  org_slug: string;
  title: string;
  city: string;
  start_date: string;
  end_date: string;
  total_jod: number | string;
  status: string;
  paid_at: string | null;
  removed_reason: string | null;
};

export async function listAdminOffers(): Promise<AdminOffer[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_offers");
  if (error) {
    logRpcError("admin_offers", error);
    return null;
  }
  const out: AdminOffer[] = [];
  for (const r of (data as OfferRow[]) ?? []) {
    const total = num(r.total_jod);
    if (total === null || (r.status !== "paid" && r.status !== "removed" && r.status !== "needs_refund")) continue;
    out.push({
      id: r.id,
      orgId: r.org_id,
      orgName: r.org_name,
      orgSlug: r.org_slug,
      title: r.title,
      city: r.city,
      startDate: r.start_date,
      endDate: r.end_date,
      totalJod: total,
      status: r.status,
      paidAt: r.paid_at,
      removedReason: r.removed_reason,
    });
  }
  return out;
}
