import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { ADMIN_PAYMENTS_LIMIT, getAdminOverview, listAdminOffers, listAdminPayments } from "@/lib/adminServer";
import { ADMIN_TZ } from "@/lib/admin";
import { parsePeriod, periodSearch } from "@/lib/period";
import { formatPrice } from "@/lib/billing";
import { PeriodPicker } from "../PeriodPicker";
import { PaymentsClient } from "./PaymentsClient";
import { OffersAdminClient } from "./OffersAdminClient";

export default async function AdminSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; custom?: string }>;
}) {
  const [lang, params] = await Promise.all([getLang(), searchParams]);
  // "YYYY-MM-DD" in the timezone offers run in, so live / scheduled match
  // what the home page shows.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ADMIN_TZ }).format(new Date());
  const period = parsePeriod(params, today);

  const [overview, payments, offers] = await Promise.all([
    getAdminOverview(period.from, period.to),
    listAdminPayments(period.from, period.to),
    listAdminOffers(),
  ]);

  return (
    <div className="admin-page">
      <div className="admin-toolbar">
        <PeriodPicker lang={lang} path="/admin/sales" period={period} today={today} />
        <Link href={`/admin/reports?${periodSearch(period)}`} className="btn sm">
          {t(lang, "admin_open_report")}
        </Link>
      </div>

      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "admin_revenue_title")}</h2>
        </div>
        {!overview ? (
          <div className="empty">{t(lang, "admin_load_failed")}</div>
        ) : overview.revenue.length === 0 ? (
          <div className="empty">{t(lang, "admin_kpi_no_revenue")}</div>
        ) : (
          <div className="card ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>{t(lang, "admin_col_currency")}</th>
                  <th>{t(lang, "admin_col_period")}</th>
                  <th>{t(lang, "admin_col_previous")}</th>
                  <th>{t(lang, "admin_col_tax")}</th>
                  <th>{t(lang, "admin_col_mrr")}</th>
                  <th>{t(lang, "admin_col_all_time")}</th>
                </tr>
              </thead>
              <tbody>
                {overview.revenue.map((r) => {
                  const mrr = overview.mrr.find((m) => m.currency === r.currency);
                  return (
                    <tr key={r.currency}>
                      <td>{r.currency}</td>
                      <td className="num">{formatPrice(r.period, r.currency, lang)}</td>
                      <td className="num">{formatPrice(r.previous, r.currency, lang)}</td>
                      <td className="num">
                        {formatPrice(r.tax, r.currency, lang)}
                        {r.uninvoiced > 0 && (
                          <span className="chip warn" style={{ marginInlineStart: 6 }}>
                            {t(lang, "admin_kpi_uninvoiced", { n: r.uninvoiced.toLocaleString(intlLocale(lang)) })}
                          </span>
                        )}
                      </td>
                      <td className="num">{mrr ? formatPrice(mrr.amount, mrr.currency, lang) : "—"}</td>
                      <td className="num">{formatPrice(r.allTime, r.currency, lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "admin_payments_title")}</h2>
        </div>
        {payments === null ? (
          <div className="empty">{t(lang, "admin_load_failed")}</div>
        ) : (
          <>
            {payments.length >= ADMIN_PAYMENTS_LIMIT && (
              <p className="offer-notice">
                {t(lang, "admin_payments_limit", { n: ADMIN_PAYMENTS_LIMIT.toLocaleString(intlLocale(lang)) })}
              </p>
            )}
            {/* key: a new period starts the list over, filter included */}
            <PaymentsClient key={`${period.from}_${period.to}`} lang={lang} payments={payments} />
          </>
        )}
      </section>

      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "admin_offers_title")}</h2>
          <span className="hint">{t(lang, "admin_now_hint")}</span>
        </div>
        {offers === null ? (
          <div className="empty">{t(lang, "admin_load_failed")}</div>
        ) : (
          <OffersAdminClient lang={lang} offers={offers} today={today} />
        )}
      </section>
    </div>
  );
}
