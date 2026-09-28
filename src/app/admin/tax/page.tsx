import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { getAdminMarkets, getTaxRegistrations } from "@/lib/adminServer";
import { getAdminCountry } from "@/lib/adminCountry";
import { getMarkets } from "@/lib/marketsServer";
import { TaxClient } from "./TaxClient";

export default async function AdminTaxPage() {
  const [lang, regs, markets, country] = await Promise.all([
    getLang(),
    getTaxRegistrations(),
    getAdminMarkets(),
    getMarkets().then(getAdminCountry),
  ]);
  // With a country chosen, only its registrations and its uninvoiced sales.
  const inCountry = <T extends { country: string }>(list: T[]) => list.filter((x) => country === null || x.country === country);

  return (
    <div className="admin-page">
      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "tax_title")}</h2>
        </div>
        <p className="hint">{t(lang, "tax_intro")}</p>
        {regs === null || markets === null ? (
          <div className="empty">{t(lang, "admin_load_failed")}</div>
        ) : (
          <TaxClient
            lang={lang}
            registrations={inCountry(regs.registrations)}
            unassigned={inCountry(regs.unassigned)}
            markets={markets}
          />
        )}
      </section>
    </div>
  );
}
