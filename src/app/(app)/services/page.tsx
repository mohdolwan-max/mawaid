import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import type { Service } from "@/lib/types";
import { ServicesClient } from "./ServicesClient";
import { PackagesClient } from "./PackagesClient";
import { parseCatalogue } from "@/lib/packages";

export default async function ServicesPage() {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  const [{ data: services }, { data: pkgRows, error: pkgError }] = await Promise.all([
    supabase.from("services").select("*").eq("org_id", ctx.orgId).order("sort_order").order("created_at"),
    supabase.rpc("list_service_packages"),
  ]);
  // Before 0064 runs the function does not exist (PGRST202): the section
  // stays hidden. Any other failure is shown as one, never as "no packages".
  const packagesMissing = pkgError?.code === "PGRST202";
  if (pkgError && !packagesMissing) console.error("list_service_packages failed", pkgError);
  const packages = pkgError ? null : parseCatalogue(pkgRows);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{t(ctx.lang, "services_title")}</h2>
          <p>{t(ctx.lang, "services_sub")}</p>
        </div>
      </div>
      <ServicesClient
        lang={ctx.lang}
        services={(services as Service[]) ?? []}
        orgId={ctx.orgId}
        canManage={ctx.role === "owner"}
        currency={ctx.currency}
      />
      {!packagesMissing && (
        <PackagesClient
          lang={ctx.lang}
          packages={packages}
          services={(services as Service[]) ?? []}
          canManage={ctx.role === "owner"}
          currency={ctx.currency}
        />
      )}
    </div>
  );
}
