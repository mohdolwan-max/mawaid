import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t, type Lang } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { getAdminOverview } from "@/lib/adminServer";
import { changePct, primaryCurrency } from "@/lib/admin";
import { currencyLabel, formatPrice } from "@/lib/billing";
import { StatTile } from "./StatTile";
import { DailyBars } from "./DailyBars";

function count(v: number | null, lang: Lang): string {
  return v === null ? "—" : v.toLocaleString(intlLocale(lang));
}

export default async function AdminOverviewPage() {
  const lang = await getLang();
  const o = await getAdminOverview();
  if (!o) return <div className="empty">{t(lang, "admin_load_failed")}</div>;

  const cur = primaryCurrency(o.revenue);
  const rev = cur ? (o.revenue.find((r) => r.currency === cur) ?? null) : null;
  const others = o.revenue.filter((r) => r.currency !== cur && r.thisMonth > 0);
  const pct = rev ? changePct(rev.thisMonth, rev.lastMonth) : null;
  const mrr = cur ? (o.mrr.find((m) => m.currency === cur) ?? null) : (o.mrr[0] ?? null);
  const s = o.subscriptions;
  const a = o.activity;

  const revenueSub = !rev
    ? t(lang, "admin_kpi_no_revenue")
    : [
        pct === null
          ? t(lang, "admin_kpi_no_compare")
          : t(lang, "admin_kpi_vs_last", { pct: `${pct > 0 ? "+" : ""}${pct}` }),
        t(lang, "admin_kpi_plans_offers", {
          plans: formatPrice(rev.plansThisMonth, rev.currency, lang),
          offers: formatPrice(rev.offersThisMonth, rev.currency, lang),
        }),
        others.length > 0
          ? t(lang, "admin_kpi_other_currencies", {
              list: others.map((r) => formatPrice(r.thisMonth, r.currency, lang)).join("، "),
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

  return (
    <div className="admin-page">
      <p className="hint">{t(lang, "admin_updated", { time: updated })}</p>

      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "admin_sec_sales")}</h2>
          <Link href="/admin/sales">{t(lang, "admin_see_all_sales")}</Link>
        </div>
        <div className="admin-tiles">
          <StatTile
            emphasis
            label={t(lang, "admin_kpi_revenue_month")}
            value={rev ? formatPrice(rev.thisMonth, rev.currency, lang) : "—"}
            sub={revenueSub}
          />
          <StatTile
            label={t(lang, "admin_kpi_mrr")}
            value={mrr ? formatPrice(mrr.amount, mrr.currency, lang) : "—"}
            sub={t(lang, "admin_kpi_mrr_hint", { n: mrr ? mrr.clinics : 0 })}
          />
          <StatTile label={t(lang, "admin_kpi_payments_month")} value={count(rev ? rev.paymentsThisMonth : 0, lang)} />
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
            tone={(o.attention.needsRefund ?? 0) > 0 ? "bad" : null}
          />
          <StatTile
            label={t(lang, "admin_kpi_failed")}
            value={count(o.attention.failed7d, lang)}
            tone={(o.attention.failed7d ?? 0) > 0 ? "warn" : null}
          />
          <StatTile
            label={t(lang, "admin_kpi_renewal_failures")}
            value={count(o.attention.renewalFailures, lang)}
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
          <StatTile
            label={t(lang, "admin_kpi_lapsed")}
            value={count(s.lapsed, lang)}
            sub={t(lang, "admin_kpi_lapsed_hint")}
          />
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
            sub={t(lang, "admin_kpi_new", { n: count(o.clinics.new30d, lang) })}
          />
          <StatTile
            label={t(lang, "admin_kpi_bookings")}
            value={count(a.bookings30d, lang)}
            sub={t(lang, "admin_kpi_bookings_7d", { n: count(a.bookings7d, lang) })}
          />
          <StatTile label={t(lang, "admin_kpi_upcoming")} value={count(a.upcoming, lang)} />
          <StatTile
            label={t(lang, "admin_kpi_customers")}
            value={count(a.customersTotal, lang)}
            sub={t(lang, "admin_kpi_new", { n: count(a.customersNew30d, lang) })}
          />
          <StatTile
            label={t(lang, "admin_kpi_rating")}
            value={a.avgRating === null ? "—" : a.avgRating.toFixed(1)}
            sub={t(lang, "admin_kpi_reviews", { n: count(a.reviews30d, lang) })}
          />
        </div>
      </section>

      <section className="admin-charts">
        <DailyBars
          lang={lang}
          title={t(lang, "admin_chart_bookings")}
          subtitle={t(lang, "admin_chart_last30")}
          points={o.series.map((d) => ({ day: d.day, value: d.bookings }))}
          unit={null}
        />
        {cur && (
          <DailyBars
            lang={lang}
            title={t(lang, "admin_chart_revenue", { currency: currencyLabel(cur, lang) })}
            subtitle={t(lang, "admin_chart_last30")}
            points={o.series.map((d) => ({ day: d.day, value: d.revenue[cur] ?? 0 }))}
            unit={currencyLabel(cur, lang)}
          />
        )}
        <DailyBars
          lang={lang}
          title={t(lang, "admin_chart_signups")}
          subtitle={t(lang, "admin_chart_last30")}
          points={o.series.map((d) => ({ day: d.day, value: d.signups }))}
          unit={null}
        />
      </section>
    </div>
  );
}
