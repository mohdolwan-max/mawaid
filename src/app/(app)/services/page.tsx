import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import type { Service } from "@/lib/types";
import { ServicesClient } from "./ServicesClient";

export default async function ServicesPage() {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  const { data: services } = await supabase
    .from("services")
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("sort_order")
    .order("created_at");

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{t(ctx.lang, "services_title")}</h2>
          <p>{t(ctx.lang, "services_sub")}</p>
        </div>
      </div>
      <ServicesClient lang={ctx.lang} services={(services as Service[]) ?? []} canManage={ctx.role === "owner"} />
    </div>
  );
}
