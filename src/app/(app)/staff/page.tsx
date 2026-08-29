import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import type { Service, StaffMember, StaffTimeOff } from "@/lib/types";
import { StaffClient } from "./StaffClient";

export default async function StaffPage() {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  const [{ data: staff }, { data: services }, { data: assignments }, { data: timeOff }] = await Promise.all([
    supabase.rpc("list_org_staff", { p_org_id: ctx.orgId }),
    supabase.from("services").select("*").eq("org_id", ctx.orgId).eq("active", true).order("sort_order"),
    supabase.from("staff_services").select("staff_membership_id, service_id").eq("org_id", ctx.orgId),
    supabase.rpc("list_staff_time_off", { p_org_id: ctx.orgId }),
  ]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{t(ctx.lang, "staff_title")}</h2>
          <p>{t(ctx.lang, "staff_sub")}</p>
        </div>
      </div>
      <StaffClient
        lang={ctx.lang}
        staff={(staff as StaffMember[]) ?? []}
        services={(services as Service[]) ?? []}
        assignments={assignments ?? []}
        timeOff={(timeOff as StaffTimeOff[]) ?? []}
        orgHours={ctx.businessHours}
        canManage={ctx.role === "owner"}
      />
    </div>
  );
}
