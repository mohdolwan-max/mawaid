"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LANG_COOKIE } from "@/lib/lang";
import type { Lang } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { slugOk } from "@/lib/branches";

export async function toggleLang(current: Lang) {
  const store = await cookies();
  const next: Lang = current === "ar" ? "en" : "ar";
  store.set(LANG_COOKIE, next, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}

// ---- Branches (0071) ------------------------------------------------------------

/** Makes another of the user's clinics the active one; the whole dashboard
 *  follows (every "my clinic" function reads it). */
export async function switchOrgAction(orgId: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_active_org", { p_org_id: orgId });
  if (error) {
    console.error("set_active_org failed", error);
    return { ok: false };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export type BranchError = "branch_err_name" | "branch_err_slug" | "branch_err_taken" | "branch_err_reserved" | "error_generic";

/** Opens a branch copied from a clinic the caller owns, and switches to it. */
export async function createBranchAction(input: {
  name: string;
  slug: string;
  fromOrgId: string;
  copyServices: boolean;
}): Promise<{ ok: true } | { ok: false; error: BranchError }> {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (name.length < 1 || name.length > 120) return { ok: false, error: "branch_err_name" };
  if (!slugOk(slug)) return { ok: false, error: "branch_err_slug" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_branch", {
    p_name: name,
    p_slug: slug,
    p_from_org: input.fromOrgId,
    p_copy_services: input.copyServices,
  });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("slug_taken")) return { ok: false, error: "branch_err_taken" };
    if (m.includes("slug_reserved")) return { ok: false, error: "branch_err_reserved" };
    if (m.includes("invalid_slug")) return { ok: false, error: "branch_err_slug" };
    if (m.includes("branch_name")) return { ok: false, error: "branch_err_name" };
    console.error("create_branch failed", error);
    return { ok: false, error: "error_generic" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
