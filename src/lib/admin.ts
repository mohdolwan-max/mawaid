// The platform admin page (0049): shapes, parsing and the small
// arithmetic the KPIs need. Free of React and the database so it can be
// tested directly.
//
// Data honesty on this page (ENGINEERING-STANDARDS §1): a KPI the database
// did not return is null and prints "—", never 0; money is kept per
// currency and never added across currencies.

/** The calendar the admin pages count days and months in. Matches
 *  _admin_tz() in 0049, which reads offer_settings with this default. */
export const ADMIN_TZ = "Asia/Amman";

export type MoneyByCurrency = { currency: string; amount: number }[];

export type RevenueRow = {
  currency: string;
  thisMonth: number;
  lastMonth: number;
  plansThisMonth: number;
  offersThisMonth: number;
  paymentsThisMonth: number;
  allTime: number;
};

export type SeriesDay = {
  day: string;
  bookings: number;
  signups: number;
  /** currency -> amount paid that day */
  revenue: Record<string, number>;
};

export type AdminOverview = {
  generatedAt: string;
  timezone: string;
  clinics: {
    total: number | null;
    listed: number | null;
    new7d: number | null;
    new30d: number | null;
    closed: number | null;
  };
  subscriptions: {
    paidActive: number | null;
    paidActiveBasic: number | null;
    paidActivePro: number | null;
    noEnd: number | null;
    trialActive: number | null;
    grace: number | null;
    lapsed: number | null;
    trialsEnding7d: number | null;
    paidEnding7d: number | null;
    autoRenewOn: number | null;
  };
  revenue: RevenueRow[];
  mrr: (MoneyByCurrency[number] & { clinics: number })[];
  attention: { needsRefund: number | null; failed7d: number | null; renewalFailures: number | null };
  offers: { liveToday: number | null; scheduled: number | null; removed: number | null };
  activity: {
    bookings7d: number | null;
    bookings30d: number | null;
    upcoming: number | null;
    cancelled30d: number | null;
    noShow30d: number | null;
    customersTotal: number | null;
    customersNew30d: number | null;
    reviews30d: number | null;
    avgRating: number | null;
  };
  series: SeriesDay[];
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** A finite number, or null. Numeric strings (Postgres numeric) count. */
export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function currencyCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

function section(root: Obj, key: string): Obj {
  const s = root[key];
  return isObj(s) ? s : {};
}

/** null when the payload is not an overview at all. Missing fields inside
 *  it become null individually, so one absent KPI does not blank the page. */
export function parseOverview(raw: unknown): AdminOverview | null {
  if (!isObj(raw) || typeof raw.generated_at !== "string") return null;
  const c = section(raw, "clinics");
  const s = section(raw, "subscriptions");
  const a = section(raw, "attention");
  const o = section(raw, "offers");
  const act = section(raw, "activity");

  const revenue: RevenueRow[] = [];
  for (const r of Array.isArray(raw.revenue) ? raw.revenue : []) {
    if (!isObj(r)) continue;
    const currency = currencyCode(r.currency);
    const thisMonth = num(r.this_month);
    const lastMonth = num(r.last_month);
    const allTime = num(r.all_time);
    if (!currency || thisMonth === null || lastMonth === null || allTime === null) continue;
    revenue.push({
      currency,
      thisMonth,
      lastMonth,
      plansThisMonth: num(r.plans_this_month) ?? 0,
      offersThisMonth: num(r.offers_this_month) ?? 0,
      paymentsThisMonth: num(r.payments_this_month) ?? 0,
      allTime,
    });
  }

  const mrr: AdminOverview["mrr"] = [];
  for (const r of Array.isArray(raw.mrr) ? raw.mrr : []) {
    if (!isObj(r)) continue;
    const currency = currencyCode(r.currency);
    const amount = num(r.amount);
    if (!currency || amount === null) continue;
    mrr.push({ currency, amount, clinics: num(r.clinics) ?? 0 });
  }

  const series: SeriesDay[] = [];
  for (const d of Array.isArray(raw.series) ? raw.series : []) {
    if (!isObj(d) || typeof d.day !== "string") continue;
    const revenueDay: Record<string, number> = {};
    if (isObj(d.revenue)) {
      for (const [k, v] of Object.entries(d.revenue)) {
        const code = currencyCode(k);
        const n = num(v);
        if (code && n !== null) revenueDay[code] = n;
      }
    }
    series.push({ day: d.day.slice(0, 10), bookings: num(d.bookings) ?? 0, signups: num(d.signups) ?? 0, revenue: revenueDay });
  }

  return {
    generatedAt: raw.generated_at,
    timezone: typeof raw.timezone === "string" ? raw.timezone : "Asia/Amman",
    clinics: {
      total: num(c.total),
      listed: num(c.listed),
      new7d: num(c.new_7d),
      new30d: num(c.new_30d),
      closed: num(c.closed),
    },
    subscriptions: {
      paidActive: num(s.paid_active),
      paidActiveBasic: num(s.paid_active_basic),
      paidActivePro: num(s.paid_active_pro),
      noEnd: num(s.no_end),
      trialActive: num(s.trial_active),
      grace: num(s.grace),
      lapsed: num(s.lapsed),
      trialsEnding7d: num(s.trials_ending_7d),
      paidEnding7d: num(s.paid_ending_7d),
      autoRenewOn: num(s.auto_renew_on),
    },
    revenue,
    mrr,
    attention: {
      needsRefund: num(a.needs_refund),
      failed7d: num(a.failed_7d),
      renewalFailures: num(a.renewal_failures),
    },
    offers: { liveToday: num(o.live_today), scheduled: num(o.scheduled), removed: num(o.removed) },
    activity: {
      bookings7d: num(act.bookings_7d),
      bookings30d: num(act.bookings_30d),
      upcoming: num(act.upcoming),
      cancelled30d: num(act.cancelled_30d),
      noShow30d: num(act.no_show_30d),
      customersTotal: num(act.customers_total),
      customersNew30d: num(act.customers_new_30d),
      reviews30d: num(act.reviews_30d),
      avgRating: num(act.avg_rating),
    },
    series,
  };
}

/** Percent change from last period, rounded. null when there is nothing
 *  to compare against (last period 0 or unknown): "+∞%" says nothing. */
export function changePct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Share as a whole percent; null when the whole is 0 or unknown. */
export function sharePct(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole === 0) return null;
  return Math.round((part / whole) * 100);
}

/** The currency the revenue chart shows: the one with most money this
 *  month, then all time; null when no money has arrived at all. */
export function primaryCurrency(revenue: readonly RevenueRow[]): string | null {
  if (revenue.length === 0) return null;
  return [...revenue].sort((x, y) => y.thisMonth - x.thisMonth || y.allTime - x.allTime)[0].currency;
}

/** Y-axis top: a clean number at or above the maximum, never 0. */
export function niceMax(values: readonly number[]): number {
  const max = Math.max(0, ...values.filter((v) => Number.isFinite(v)));
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * pow >= max) return step * pow;
  }
  return 10 * pow;
}

export type ClinicPhase = "active" | "grace" | "lapsed" | "closed";

export type AdminClinic = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  category: string | null;
  plan: string;
  isTrial: boolean;
  planExpiresAt: string | null;
  phase: ClinicPhase;
  isListed: boolean;
  isDemo: boolean;
  createdAt: string;
  deletedAt: string | null;
  ownerEmail: string | null;
  servicesCount: number;
  bookings30d: number;
  lastBookingAt: string | null;
  paidTotals: MoneyByCurrency;
  autoRenew: boolean;
  cardLabel: string | null;
};

/** The subscription bucket a clinic is listed under on the page. */
export type ClinicBucket = "paid" | "trial" | "grace" | "lapsed" | "closed";

export function clinicBucket(c: Pick<AdminClinic, "phase" | "isTrial">): ClinicBucket {
  if (c.phase === "closed") return "closed";
  if (c.phase === "grace") return "grace";
  if (c.phase === "lapsed") return "lapsed";
  return c.isTrial ? "trial" : "paid";
}

export function isClinicPhase(v: unknown): v is ClinicPhase {
  return v === "active" || v === "grace" || v === "lapsed" || v === "closed";
}

/** Case-insensitive match on name, slug, owner email or city. */
export function matchesClinic(c: Pick<AdminClinic, "name" | "slug" | "ownerEmail" | "city">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [c.name, c.slug, c.ownerEmail ?? "", c.city ?? ""].some((f) => f.toLowerCase().includes(q));
}

/** A typed reason the database will accept (it requires 3+ characters). */
export function reasonOk(reason: string): boolean {
  return [...reason.trim()].length >= 3;
}

export type AdminPayment = {
  id: string;
  createdAt: string;
  paidAt: string | null;
  orgId: string;
  orgName: string;
  orgSlug: string;
  kind: "plan" | "offer";
  planId: string | null;
  period: "month" | "year" | null;
  offerTitle: string | null;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "cancelled" | "needs_refund" | "refunded";
  outcome: string | null;
  failureReason: string | null;
  provider: string | null;
  providerRef: string | null;
  isRenewal: boolean;
  refundedAt: string | null;
  refundNote: string | null;
};

export type AdminOffer = {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  title: string;
  city: string;
  startDate: string;
  endDate: string;
  totalJod: number;
  status: "paid" | "removed" | "needs_refund";
  paidAt: string | null;
  removedReason: string | null;
};

/** Where a paid offer stands against today ("YYYY-MM-DD" in the offer
 *  timezone): only live or upcoming paid offers can still be taken down. */
export function offerTiming(o: Pick<AdminOffer, "status" | "startDate" | "endDate">, today: string): "live" | "scheduled" | "ended" | "other" {
  if (o.status !== "paid") return "other";
  if (today < o.startDate) return "scheduled";
  if (today > o.endDate) return "ended";
  return "live";
}

export function currencyCodeOrNull(v: unknown): string | null {
  return currencyCode(v);
}
