import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { listAdminClinics } from "@/lib/adminServer";
import { ClinicsClient } from "./ClinicsClient";

export default async function AdminSubscriptionsPage() {
  const [lang, clinics] = await Promise.all([getLang(), listAdminClinics()]);
  if (!clinics) return <div className="empty">{t(lang, "admin_load_failed")}</div>;
  return <ClinicsClient lang={lang} clinics={clinics} nowIso={new Date().toISOString()} />;
}
