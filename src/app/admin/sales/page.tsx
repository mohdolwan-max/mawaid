import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { getAdminOverview, listAdminOffers, listAdminPayments } from "@/lib/adminServer";
import { ADMIN_TZ } from "@/lib/admin";
import { formatPrice } from "@/lib/billing";
import { PaymentsClient } from "./PaymentsClient";
import { OffersAdminClient } from "./OffersAdminClient";

export default async function AdminSalesPage() {
  const [lang, overview, payments, offers] = await Promise.all([
    getLang(),
    getAdminOverview(),
    listAdminPayments(),
    listAdminOffers(),
  ]);

  // "YYYY-MM-DD" in the timezone offers run in, so live / scheduled match
  // what the home page shows.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ADMIN_TZ }).format(new Date());

  return (
    <div className="admin-page">
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
                  <th>{t(lang, "admin_col_this_month")}</th>
                  <th>{t(lang, "admin_col_last_month")}</th>
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
                      <td className="num">{formatPrice(r.thisMonth, r.currency, lang)}</td>
                      <td className="num">{formatPrice(r.lastMonth, r.currency, lang)}</td>
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
          <PaymentsClient lang={lang} payments={payments} />
        )}
      </section>

      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "admin_offers_title")}</h2>
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
