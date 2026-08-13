"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BusinessHours } from "@/lib/types";

export async function createOrgAction(input: {
  name: string;
  slug: string;
  address: string;
  phone: string;
  category: string;
  city: string;
}): Promise<{ orgId: string } | { error: string }> {
  const supabase = await createClient();

  const { data: orgId, error } = await supabase.rpc("create_organization", {
    p_name: input.name,
    p_slug: input.slug,
  });

  if (error) {
    if (error.message.includes("slug_taken") || error.message.includes("slug_reserved")) {
      return { error: "org_slug_taken" };
    }
    if (error.message.includes("invalid_slug")) {
      return { error: "org_slug_invalid" };
    }
    return { error: "error_generic" };
  }

  await supabase
    .from("organizations")
    .update({
      address: input.address.trim() || null,
      phone: input.phone.trim() || null,
      category: input.category || null,
      city: input.city || null,
    })
    .eq("id", orgId);

  return { orgId: orgId as string };
}

export async function saveHoursAction(
  orgId: string,
  businessHours: BusinessHours
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("org_settings")
    .update({ business_hours: businessHours })
    .eq("org_id", orgId);

  if (error) return { error: "error_generic" };
  return { ok: true };
}

export async function finishOnboardingAction(
  orgId: string,
  service: { name: string; duration: number; price: number | null }
): Promise<{ error: string } | never> {
  const supabase = await createClient();

  const { error: svcError } = await supabase.from("services").insert({
    org_id: orgId,
    name: service.name,
    duration_minutes: service.duration,
    price: service.price,
  });

  if (svcError) return { error: "error_generic" };

  const { error: settingsError } = await supabase
    .from("org_settings")
    .update({ wizard_done: true })
    .eq("org_id", orgId);

  if (settingsError) return { error: "error_generic" };

  redirect("/dashboard");
}
