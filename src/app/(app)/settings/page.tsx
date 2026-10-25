import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import { SettingsClient, type DirectoryProfile } from "./SettingsClient";
import { DeleteAccountCard } from "@/components/DeleteAccountCard";
import { getPendingDeletion } from "@/app/account/deleteActions";

export default async function SettingsPage() {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  // Directory columns (and maps_url) aren't part of get_my_context()
  // (kept out of the hot auth path) — fetched directly here under the
  // members-select RLS policy.
  const { data: dir, error: dirError } = await supabase
    .from("organizations")
    .select("is_listed, category, city, district, description, price_tier, cover_image_url, logo_url, maps_url, lat, lng")
    .eq("id", ctx.orgId)
    .single();

  // Never render a writable form from defaults when the read failed:
  // every field the form did not actually load gets written back as its
  // fallback on the next save — is_listed false, maps_url null, the lot.
  // That is the exact mechanism that silently reset a settings column
  // once before (see ENGINEERING-STANDARDS §1). An error page is honest;
  // a defaults form is a trap.
  if (dirError || !dir) {
    throw new Error(`settings read failed: ${dirError?.message ?? "no row"}`);
  }

  // Compact scheduling (0061). Read on its own: before 0061 the column does
  // not exist, and the switch is then not shown at all — never shown as
  // "off" and never written back (ENGINEERING-STANDARDS §1).
  const { data: rules, error: rulesError } = await supabase
    .from("org_settings")
    .select("compact_slots")
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  const compactSlots: boolean | null =
    !rulesError && rules && typeof rules.compact_slots === "boolean" ? rules.compact_slots : null;

  const directory: DirectoryProfile = {
    isListed: dir.is_listed ?? false,
    category: dir.category ?? "",
    city: dir.city ?? "",
    district: dir.district ?? "",
    description: dir.description ?? "",
    priceTier: dir.price_tier ?? null,
    coverImageUrl: dir.cover_image_url ?? null,
    logoUrl: dir.logo_url ?? null,
    // null stays null: an unset location must reach the form as empty
    // fields, never as 0/0 — which is a real place in the Atlantic.
    lat: dir.lat ?? null,
    lng: dir.lng ?? null,
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
        mapsUrl={dir.maps_url ?? ""}
        compactSlots={compactSlots}
      />
      {ctx.role === "owner" && (
        <DeleteAccountCard lang={ctx.lang} pendingUntil={await getPendingDeletion()} />
      )}
    </div>
  );
}
