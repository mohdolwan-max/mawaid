import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import { SettingsClient, type DirectoryProfile } from "./SettingsClient";

export default async function SettingsPage() {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  // Directory columns (and maps_url) aren't part of get_my_context()
  // (kept out of the hot auth path) — fetched directly here under the
  // members-select RLS policy.
  const { data: dir } = await supabase
    .from("organizations")
    .select("is_listed, category, city, district, description, price_tier, cover_image_url, logo_url, maps_url")
    .eq("id", ctx.orgId)
    .single();

  const directory: DirectoryProfile = {
    isListed: dir?.is_listed ?? false,
    category: dir?.category ?? "",
    city: dir?.city ?? "",
    district: dir?.district ?? "",
    description: dir?.description ?? "",
    priceTier: dir?.price_tier ?? null,
    coverImageUrl: dir?.cover_image_url ?? null,
    logoUrl: dir?.logo_url ?? null,
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{t(ctx.lang, "settings_title")}</h2>
        </div>
      </div>
      <SettingsClient
        ctx={ctx}
        canManage={ctx.role === "owner"}
        directory={directory}
        mapsUrl={dir?.maps_url ?? ""}
      />
    </div>
  );
}
