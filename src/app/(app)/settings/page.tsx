import { requireOrgContext } from "@/lib/org";
import { t } from "@/lib/i18n";
import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage() {
  const ctx = await requireOrgContext();

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{t(ctx.lang, "settings_title")}</h2>
        </div>
      </div>
      <SettingsClient ctx={ctx} canManage={ctx.role === "owner"} />
    </div>
  );
}
