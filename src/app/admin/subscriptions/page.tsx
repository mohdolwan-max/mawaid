import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { listAdminClinics } from "@/lib/adminServer";
import { getAdminCountry } from "@/lib/adminCountry";
import { getMarkets } from "@/lib/marketsServer";
import { ClinicsClient } from "./ClinicsClient";

export default async function AdminSubscriptionsPage() {
  const markets = await getMarkets();
  const country = await getAdminCountry(markets);
  const [lang, clinics] = await Promise.all([getLang(), listAdminClinics(country)]);
  if (!clinics) return <div className="empty">{t(lang, "admin_load_failed")}</div>;
  return <ClinicsClient lang={lang} clinics={clinics} markets={markets} nowIso={new Date().toISOString()} />;
}
