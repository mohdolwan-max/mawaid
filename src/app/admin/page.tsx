import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t, type Lang } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { getAdminOverview } from "@/lib/adminServer";
import { ADMIN_TZ, changePct, primaryCurrency } from "@/lib/admin";
import { bucketSeries, bucketSize, parsePeriod, periodSearch } from "@/lib/period";
import { currencyLabel, formatPrice } from "@/lib/billing";
import { StatTile } from "@/components/StatTile";
import { DailyBars } from "@/components/DailyBars";
import { PeriodPicker } from "@/components/PeriodPicker";

function count(v: number | null, lang: Lang): string {
  return v === null ? "—" : v.toLocaleString(intlLocale(lang));
}

function vsPrevious(current: number | null, previous: number | null, lang: Lang): string {
  const pct = changePct(current, previous);
  return pct === null
    ? t(lang, "admin_kpi_no_compare")
    : t(lang, "admin_kpi_vs_prev", { pct: `${pct > 0 ? "+" : ""}${pct}` });
}

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; custom?: string }>;
}) {
  const [lang, params] = await Promise.all([getLang(), searchParams]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ADMIN_TZ }).format(new Date());
  const period = parsePeriod(params, today);
  const o = await getAdminOverview(period.from, period.to);

  const picker = <PeriodPicker lang={lang} path="/admin" period={period} today={today} />;
  if (!o) {
    return (
      <div className="admin-page">
        {picker}
        <div className="empty">{t(lang, "admin_load_failed")}</div>
      </div>
    );
  }

  const cur = primaryCurrency(o.revenue);
  const rev = cur ? (o.revenue.find((r) => r.currency === cur) ?? null) : null;
  const others = o.revenue.filter((r) => r.currency !== cur && r.period > 0);
  const mrr = cur ? (o.mrr.find((m) => m.currency === cur) ?? null) : (o.mrr[0] ?? null);
  const s = o.subscriptions;
  const a = o.activity;
  const uninvoiced = o.revenue.reduce((n, r) => n + r.uninvoiced, 0);
  const query = periodSearch(period);

  const revenueSub = !rev
    ? t(lang, "admin_kpi_no_revenue")
    : [
        vsPrevious(rev.period, rev.previous, lang),
        t(lang, "admin_kpi_plans_offers", {
          plans: formatPrice(rev.plans, rev.currency, lang),
          offers: formatPrice(rev.offers, rev.currency, lang),
        }),
        others.length > 0
          ? t(lang, "admin_kpi_other_currencies", {
              list: others.map((r) => formatPrice(r.period, r.currency, lang)).join("، "),
            })
          : "",
      ]
        .filter(Boolean)
        .join(" · ");

  const updated = new Intl.DateTimeFormat(intlLocale(lang), {
    timeZone: o.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(o.generatedAt));

  const size = bucketSize(period.from, period.to);
  const chartSub = t(lang, size === "day" ? "admin_chart_by_day" : size === "week" ? "admin_chart_by_week" : "admin_chart_by_month");
  const series = (pick: (d: NonNullable<typeof o>["series"][number]) => number) =>
    bucketSeries(o.series.map((d) => ({ day: d.day, value: pick(d) })), period.from, period.to);

  return (
    <div className="admin-page">
      <div className="admin-toolbar">
        {picker}
        <p className="hint">{t(lang, "admin_updated", { time: updated })}</p>
      </div>

      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "admin_sec_sales")}</h2>
          <Link href={`/admin/sales?${query}`}>{t(lang, "admin_see_all_sales")}</Link>
        </div>
        <div className="admin-tiles">
          <StatTile
            emphasis
            label={t(lang, "admin_kpi_revenue_period")}
            value={rev ? formatPrice(rev.period, rev.currency, lang) : "—"}
            sub={revenueSub}
          />
          <StatTile
            label={t(lang, "admin_kpi_tax_period")}
            value={rev ? formatPrice(rev.tax, rev.currency, lang) : "—"}
            sub={uninvoiced > 0 ? t(lang, "admin_kpi_uninvoiced", { n: count(uninvoiced, lang) }) : t(lang, "admin_kpi_tax_hint")}
            tone={uninvoiced > 0 ? "warn" : null}
          />
          <StatTile label={t(lang, "admin_kpi_payments_period")} value={count(rev ? rev.payments : 0, lang)} />
          <StatTile
            label={t(lang, "admin_kpi_mrr")}
            value={mrr ? formatPrice(mrr.amount, mrr.currency, lang) : "—"}
            sub={t(lang, "admin_kpi_mrr_hint", { n: mrr ? mrr.clinics : 0 })}
          />
          <StatTile
            label={t(lang, "admin_kpi_offers_live")}
            value={count(o.offers.liveToday, lang)}
            sub={t(lang, "admin_kpi_offers_scheduled", { n: count(o.offers.scheduled, lang) })}
          />
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "admin_sec_attention")}</h2>
        </div>
        <div className="admin-tiles">
          <StatTile
            label={t(lang, "admin_kpi_needs_refund")}
            value={count(o.attention.needsRefund, lang)}
            sub={t(lang, "admin_now_hint")}
            tone={(o.attention.needsRefund ?? 0) > 0 ? "bad" : null}
          />
          <StatTile
            label={t(lang, "admin_kpi_failed")}
            value={count(o.attention.failed, lang)}
            tone={(o.attention.failed ?? 0) > 0 ? "warn" : null}
          />
          <StatTile
            label={t(lang, "admin_kpi_renewal_failures")}
            value={count(o.attention.renewalFailures, lang)}
            sub={t(lang, "admin_now_hint")}
            tone={(o.attention.renewalFailures ?? 0) > 0 ? "warn" : null}
          />
          <StatTile
            label={t(lang, "admin_kpi_grace")}
            value={count(s.grace, lang)}
            sub={t(lang, "admin_kpi_grace_hint")}
            tone={(s.grace ?? 0) > 0 ? "warn" : null}
          />
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "admin_sec_subs")}</h2>
          <span className="hint">{t(lang, "admin_now_hint")}</span>
          <Link href="/admin/subscriptions">{t(lang, "admin_see_all_subs")}</Link>
        </div>
        <div className="admin-tiles">
          <StatTile
            label={t(lang, "admin_kpi_paid_active")}
            value={count(s.paidActive, lang)}
            sub={[
              t(lang, "admin_kpi_basic_pro", { basic: count(s.paidActiveBasic, lang), pro: count(s.paidActivePro, lang) }),
              (s.noEnd ?? 0) > 0 ? t(lang, "admin_kpi_no_end", { n: count(s.noEnd, lang) }) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          <StatTile
            label={t(lang, "admin_kpi_trials")}
            value={count(s.trialActive, lang)}
            sub={t(lang, "admin_kpi_ending", { n: count(s.trialsEnding7d, lang) })}
          />
          <StatTile label={t(lang, "admin_kpi_lapsed")} value={count(s.lapsed, lang)} sub={t(lang, "admin_kpi_lapsed_hint")} />
          <StatTile
            label={t(lang, "admin_kpi_paid_ending")}
            value={count(s.paidEnding7d, lang)}
            sub={t(lang, "admin_kpi_auto_renew", { n: count(s.autoRenewOn, lang) })}
          />
        </div>
      </section>

      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "admin_sec_activity")}</h2>
        </div>
        <div className="admin-tiles">
          <StatTile
            label={t(lang, "admin_kpi_clinics")}
            value={count(o.clinics.total, lang)}
            sub={t(lang, "admin_kpi_new", { n: count(o.clinics.new, lang) })}
          />
          <StatTile
            label={t(lang, "admin_kpi_bookings")}
            value={count(a.bookings, lang)}
            sub={[
              vsPrevious(a.bookings, a.bookingsPrev, lang),
              t(lang, "admin_kpi_cancelled_noshow", { cancelled: count(a.cancelled, lang), noshow: count(a.noShow, lang) }),
            ].join(" · ")}
          />
          <StatTile label={t(lang, "admin_kpi_upcoming")} value={count(a.upcoming, lang)} sub={t(lang, "admin_now_hint")} />
          <StatTile
            label={t(lang, "admin_kpi_customers")}
            value={count(a.customersTotal, lang)}
            sub={t(lang, "admin_kpi_new", { n: count(a.customersNew, lang) })}
          />
          <StatTile
            label={t(lang, "admin_kpi_rating")}
            value={a.avgRating === null ? "—" : a.avgRating.toFixed(1)}
            sub={t(lang, "admin_kpi_reviews", { n: count(a.reviews, lang) })}
          />
        </div>
      </section>

      <section className="admin-charts">
        <DailyBars
          lang={lang}
          title={t(lang, "admin_chart_bookings")}
          subtitle={chartSub}
          size={size}
          points={series((d) => d.bookings)}
          unit={null}
        />
        {cur && (
          <DailyBars
            lang={lang}
            title={t(lang, "admin_chart_revenue", { currency: currencyLabel(cur, lang) })}
            subtitle={chartSub}
            size={size}
            points={series((d) => d.revenue[cur] ?? 0)}
            unit={currencyLabel(cur, lang)}
          />
        )}
        <DailyBars
          lang={lang}
          title={t(lang, "admin_chart_signups")}
          subtitle={chartSub}
          size={size}
          points={series((d) => d.signups)}
          unit={null}
        />
      </section>
    </div>
  );
}
