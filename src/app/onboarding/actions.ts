"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { BusinessHours } from "@/lib/types";
import { countryOfCity } from "@/lib/directory";

export async function createOrgAction(input: {
  name: string;
  slug: string;
  address: string;
  phone: string;
  category: string;
  city: string;
  country: string;
}): Promise<{ orgId: string } | { error: string }> {
  // Checked before the clinic is created: the database refuses a city
  // outside the country (0056), and a refusal after creation would leave a
  // clinic with no city.
  if (!input.country) return { error: "org_country_required" };
  if (input.city && countryOfCity(input.city) !== input.country) return { error: "org_city_invalid" };

  const supabase = await createClient();

  const { data: orgId, error } = await supabase.rpc("create_organization", {
    p_name: input.name,
    p_slug: input.slug,
    p_country: input.country,
  });

  if (error) {
    if (error.message.includes("country_not_open")) {
      return { error: "org_country_closed" };
    }
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
