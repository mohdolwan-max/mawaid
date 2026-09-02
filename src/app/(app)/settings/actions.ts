"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { ORG_TAG } from "@/lib/publicOrg";
import { DIRECTORY_TAG } from "@/lib/directoryServer";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";
import { isSafeHttpUrl } from "@/lib/url";
import type { BusinessHours } from "@/lib/types";

export async function saveOrgProfile(input: {
  name: string;
  address: string;
  phone: string;
  mapsUrl: string;
}) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();
  const mapsUrl = input.mapsUrl.trim();
  await supabase
    .from("organizations")
    .update({
      name: input.name.trim(),
      address: input.address.trim() || null,
      phone: input.phone.trim() || null,
      // Silently drops anything that isn't a real http(s) link (e.g. a
      // "javascript:" scheme) rather than erroring — this is rendered as
      // a real <a href> for anonymous visitors later, see src/lib/url.ts.
      maps_url: mapsUrl && isSafeHttpUrl(mapsUrl) ? mapsUrl : null,
    })
    .eq("id", ctx.orgId);
  revalidatePath("/settings");
  revalidatePath(`/${ctx.slug}`);
  revalidateTag(ORG_TAG);
  revalidateTag(DIRECTORY_TAG);
}

export async function saveDirectoryProfile(input: {
  isListed: boolean;
  category: string;
  city: string;
  district: string;
  description: string;
  priceTier: number | null;
  lat: number | null;
  lng: number | null;
}) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  // A location is written only as a valid PAIR, or cleared as a pair.
  // Anything else — one coordinate typed, garbage, out of range — leaves
  // the stored location untouched rather than corrupting it. The UI
  // blocks those cases with a visible error before ever calling this;
  // the server refuses them independently because the DB constraint
  // (org_location_valid) would otherwise fail the WHOLE update and take
  // the rest of the form's fields down with it.
  const validPair =
    input.lat !== null && input.lng !== null &&
    Number.isFinite(input.lat) && Number.isFinite(input.lng) &&
    Math.abs(input.lat) <= 90 && Math.abs(input.lng) <= 180;
  const clearedPair = input.lat === null && input.lng === null;

  await supabase
    .from("organizations")
    .update({
      is_listed: input.isListed,
      category: input.category || null,
      city: input.city || null,
      district: input.district.trim() || null,
      description: input.description.trim() || null,
      price_tier: input.priceTier,
      ...(validPair || clearedPair ? { lat: input.lat, lng: input.lng } : {}),
    })
    .eq("id", ctx.orgId);
  revalidatePath("/settings");
  revalidatePath("/");
  revalidateTag(DIRECTORY_TAG);
  revalidatePath(`/${ctx.slug}`);
  revalidateTag(ORG_TAG);
  revalidateTag(DIRECTORY_TAG);
}

// Called after the browser uploads to the org-media bucket; persists the
// resulting public URL on the org row.
export async function saveMediaUrl(kind: "cover" | "logo", url: string) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();
  await supabase
    .from("organizations")
    .update(kind === "cover" ? { cover_image_url: url } : { logo_url: url })
    .eq("id", ctx.orgId);
  revalidatePath("/settings");
  revalidatePath(`/${ctx.slug}`);
  revalidateTag(ORG_TAG);
  revalidateTag(DIRECTORY_TAG);
}

export async function saveBookingRules(input: {
  businessHours: BusinessHours;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
}) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();
  await supabase
    .from("org_settings")
    .update({
      business_hours: input.businessHours,
      slot_interval_minutes: input.slotIntervalMinutes,
      min_notice_minutes: input.minNoticeMinutes,
      max_advance_days: input.maxAdvanceDays,
    })
    .eq("org_id", ctx.orgId);
  revalidatePath("/settings");
}

// Soft-delete only (see 0020_close_organization.sql) — the RPC itself
// re-checks ownership server-side, this isn't the only guard.
// requireOrgContext() already redirects to /auth/signout on the next
// request once organizations.deleted_at is set, but the caller
// navigates there directly right after this resolves rather than
// waiting on a stale page to reload into that redirect.
export async function closeOrganization() {
  await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_organization");
  if (error) throw error;
}
