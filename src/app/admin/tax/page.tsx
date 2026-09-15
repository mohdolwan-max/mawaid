import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { getTaxRegistrations } from "@/lib/adminServer";
import { TaxClient } from "./TaxClient";

export default async function AdminTaxPage() {
  const [lang, regs] = await Promise.all([getLang(), getTaxRegistrations()]);

  return (
    <div className="admin-page">
      <section className="admin-section">
        <div className="admin-sec-head">
          <h2>{t(lang, "tax_title")}</h2>
        </div>
        <p className="hint">{t(lang, "tax_intro")}</p>
        {regs === null ? (
          <div className="empty">{t(lang, "admin_load_failed")}</div>
        ) : (
          <TaxClient lang={lang} registrations={regs.registrations} unassigned={regs.unassigned} />
        )}
      </section>
    </div>
  );
}
