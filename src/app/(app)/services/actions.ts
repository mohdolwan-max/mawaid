"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { ORG_TAG } from "@/lib/publicOrg";
import { DIRECTORY_TAG } from "@/lib/directoryServer";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";
import { parseServiceEdit, type ServiceEditError } from "@/lib/serviceEdit";
import { isOrgMediaUrl } from "@/lib/url";
import { parsePackageInput, type PackageInputError } from "@/lib/packages";

export async function addService(formData: FormData) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  const duration = Number(formData.get("duration"));
  const priceRaw = String(formData.get("price") ?? "").trim();

  if (!name || !duration) return;

  await supabase.from("services").insert({
    org_id: ctx.orgId,
    name,
    duration_minutes: duration,
    price: priceRaw === "" ? null : Number(priceRaw),
  });

  revalidatePath("/services");
}

// Owner report: "الخدمة بس تنزل ما بقدر اعدل سعرها او غيره". A service
// could be added, switched off or deleted, but a wrong price or duration
// meant deleting it and adding it again, which also loses its photo and
// its staff assignments. This edits the three fields the add form sets.
export async function updateService(
  serviceId: string,
  input: { name: string; duration: string; price: string }
): Promise<{ error?: ServiceEditError | "error_generic" }> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "owner") return { error: "error_generic" };

  const parsed = parseServiceEdit(input);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .update({
      name: parsed.name,
      duration_minutes: parsed.durationMinutes,
      price: parsed.price,
    })
    .eq("id", serviceId)
    .eq("org_id", ctx.orgId)
    .select("id");

  // An update RLS refuses changes zero rows without an error; that is a
  // failed save, not a successful one.
  if (error || !data || data.length === 0) {
    if (error) console.error("updateService failed", error);
    return { error: "error_generic" };
  }

  revalidatePath("/services");
  revalidatePath(`/${ctx.slug}`);
  // The directory card shows the lowest price, and the public page lists
  // name, duration and price: both are cached.
  revalidateTag(ORG_TAG);
  revalidateTag(DIRECTORY_TAG);
  return {};
}

export async function toggleServiceActive(serviceId: string, active: boolean) {
  const supabase = await createClient();
  await supabase.from("services").update({ active }).eq("id", serviceId);
  revalidatePath("/services");
}

export async function deleteService(serviceId: string) {
  const supabase = await createClient();
  await supabase.from("services").delete().eq("id", serviceId);
  revalidatePath("/services");
}

// Called after the browser uploads to the org-media bucket (same
// bucket/path convention as the org cover/logo in Settings — see
// SettingsClient.tsx's handleUpload).
export async function saveServicePhoto(serviceId: string, url: string) {
  const ctx = await requireOrgContext();
  // Same rule as the org cover and logo (lib/url.ts).
  if (!isOrgMediaUrl(url, ctx.orgId)) {
    throw new Error("invalid_media_url");
  }
  const supabase = await createClient();
  const { error } = await supabase.from("services").update({ photo_url: url }).eq("id", serviceId);
  if (error) throw error;
  revalidatePath("/services");
  revalidatePath(`/${ctx.slug}`);
  revalidateTag(ORG_TAG);
  revalidateTag(DIRECTORY_TAG);
}

// ---- Session packages (0064): the catalogue, owner only (the database
// refuses anyone else; ctx.role only spares the round trip). ----------------

type PackageSaveError = PackageInputError | "error_generic";

export async function savePackageAction(
  id: string | null,
  input: { serviceId: string; name: string; sessions: string; price: string; validityDays: string }
): Promise<{ ok: true } | { ok: false; error: PackageSaveError }> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "owner") return { ok: false, error: "error_generic" };
  const parsed = parsePackageInput(input);
  if (!parsed.ok) return parsed;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_service_package", {
    p_id: id,
    p_service_id: parsed.serviceId,
    p_name: parsed.name,
    p_sessions: parsed.sessions,
    p_price: parsed.price,
    p_validity_days: parsed.validityDays,
  });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("package_name")) return { ok: false, error: "package_err_name" };
    if (m.includes("package_sessions")) return { ok: false, error: "package_err_sessions" };
    if (m.includes("package_price")) return { ok: false, error: "package_err_price" };
    if (m.includes("package_validity")) return { ok: false, error: "package_err_validity" };
    if (m.includes("service_not_found")) return { ok: false, error: "package_err_service" };
    console.error("save_service_package failed", error);
    return { ok: false, error: "error_generic" };
  }
  revalidatePath("/services");
  return { ok: true };
}

export async function setPackageActiveAction(id: string, active: boolean): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_service_package_active", { p_id: id, p_active: active });
  if (error) {
    console.error("set_service_package_active failed", error);
    return { ok: false };
  }
  revalidatePath("/services");
  return { ok: true };
}

/** 'deleted', or 'archived' when the package was sold (its sales point at
 *  it, so it is retired instead). */
export async function deletePackageAction(id: string): Promise<{ ok: true; outcome: "deleted" | "archived" } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_service_package", { p_id: id });
  if (error || (data !== "deleted" && data !== "archived")) {
    if (error) console.error("delete_service_package failed", error);
    return { ok: false };
  }
  revalidatePath("/services");
  return { ok: true, outcome: data };
}
