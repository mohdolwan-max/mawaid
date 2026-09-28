import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { getAdminMarkets } from "@/lib/adminServer";
import { getAdminCountry } from "@/lib/adminCountry";
import { getMarkets } from "@/lib/marketsServer";
import { paymentsReady } from "@/lib/payments";
import { MarketsClient } from "./MarketsClient";

// Countries, their switches and their prices (0056). The gateway keys live
// in the server's environment, which only this page can see, so it reports
// them next to what the database says each country still lacks.
export default async function AdminMarketsPage() {
  const [lang, all, country] = await Promise.all([getLang(), getAdminMarkets(), getMarkets().then(getAdminCountry)]);
  // The switcher at the top chooses the country here too, as on every other
  // admin page (owner: "شو وظيفة التاب اذا الاردن بتضل موجودة بس اضغط
  // السعودية").
  const markets = all && country ? all.filter((m) => m.code === country) : all;

  return (
    <div className="admin-page">
      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "markets_title")}</h2>
        </div>
        <p className="hint">{t(lang, "markets_intro")}</p>
        {markets === null ? (
          <div className="empty">{t(lang, "admin_load_failed")}</div>
        ) : (
          <MarketsClient
            lang={lang}
            markets={markets}
            gatewayReady={Object.fromEntries(markets.map((m) => [m.code, paymentsReady(m.code)]))}
          />
        )}
      </section>
    </div>
  );
}
