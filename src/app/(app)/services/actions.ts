"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { ORG_TAG } from "@/lib/publicOrg";
import { DIRECTORY_TAG } from "@/lib/directoryServer";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";

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
  const supabase = await createClient();
  const { error } = await supabase.from("services").update({ photo_url: url }).eq("id", serviceId);
  if (error) throw error;
  revalidatePath("/services");
  revalidatePath(`/${ctx.slug}`);
  revalidateTag(ORG_TAG);
  revalidateTag(DIRECTORY_TAG);
}
