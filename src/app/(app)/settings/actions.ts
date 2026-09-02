"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { ORG_TAG } from "@/lib/publicOrg";
import { DIRECTORY_TAG } from "@/lib/directoryServer";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";
import { isSafeHttpUrl } from "@/lib/url";
import type { BusinessHours } from "@/lib/types";

// Every save reports back. The old shape — fire the update, ignore the
// error, revalidate anyway — meant a failed write looked EXACTLY like a
// successful one: the page revalidated to the old values and the owner's
// edit just quietly reverted. A result object, not a throw: production
// Next.js masks thrown server-action errors behind a digest.
export type SaveResult = { ok: true } | { ok: false; message: string };

export async function saveOrgProfile(input: {
  name: string;
  address: string;
  phone: string;
  mapsUrl: string;
}): Promise<SaveResult> {
  const ctx = await requireOrgContext();
  const supabase = await createClient();
  const mapsUrl = input.mapsUrl.trim();
  const { error } = await supabase
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
  if (error) {
    console.error("saveOrgProfile failed", error);
    return { ok: false, message: error.message };
  }
  revalidatePath("/settings");
  revalidatePath(`/${ctx.slug}`);
  revalidateTag(ORG_TAG);
  revalidateTag(DIRECTORY_TAG);
  return { ok: true };
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
}): Promise<SaveResult> {
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

  const payload = {
    is_listed: input.isListed,
    category: input.category || null,
    city: input.city || null,
    district: input.district.trim() || null,
    description: input.description.trim() || null,
    price_tier: input.priceTier,
  };
  const locPayload = validPair || clearedPair ? { lat: input.lat, lng: input.lng } : {};

  let { error } = await supabase
    .from("organizations")
    .update({ ...payload, ...locPayload })
    .eq("id", ctx.orgId);

  // Deploy window: this code live before 0031 — PostgREST rejects the
  // unknown lat/lng columns and would take the WHOLE form down with
  // them (the 0024-era lesson: one unknown column stopped a settings
  // form saving entirely). Retry without the location so everything
  // that existed before this feature still saves.
  if (error && Object.keys(locPayload).length > 0) {
    const retry = await supabase.from("organizations").update(payload).eq("id", ctx.orgId);
    error = retry.error;
  }
  if (error) {
    console.error("saveDirectoryProfile failed", error);
    return { ok: false, message: error.message };
  }
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath(`/${ctx.slug}`);
  revalidateTag(ORG_TAG);
  revalidateTag(DIRECTORY_TAG);
  return { ok: true };
}

// Called after the browser uploads to the org-media bucket; persists the
// resulting public URL on the org row.
export async function saveMediaUrl(kind: "cover" | "logo", url: string): Promise<SaveResult> {
  const ctx = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update(kind === "cover" ? { cover_image_url: url } : { logo_url: url })
    .eq("id", ctx.orgId);
  if (error) {
    console.error("saveMediaUrl failed", error);
    return { ok: false, message: error.message };
  }
  revalidatePath("/settings");
  revalidatePath(`/${ctx.slug}`);
  revalidateTag(ORG_TAG);
  revalidateTag(DIRECTORY_TAG);
  return { ok: true };
}

export async function saveBookingRules(input: {
  businessHours: BusinessHours;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
}): Promise<SaveResult> {
  const ctx = await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase
    .from("org_settings")
    .update({
      business_hours: input.businessHours,
      slot_interval_minutes: input.slotIntervalMinutes,
      min_notice_minutes: input.minNoticeMinutes,
      max_advance_days: input.maxAdvanceDays,
    })
    .eq("org_id", ctx.orgId);
  if (error) {
    console.error("saveBookingRules failed", error);
    return { ok: false, message: error.message };
  }
  revalidatePath("/settings");
  return { ok: true };
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
