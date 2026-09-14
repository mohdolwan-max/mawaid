"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";
import { normalizeOfferTitle } from "@/lib/offers";

// Every refusal create_offer_order / cancel_my_offer can raise (0045),
// mapped to the message that names the rule the clinic hit.
const DB_ERRORS = {
  offer_no_city: "offer_no_city",
  offer_not_listed: "offer_not_listed",
  offer_title_length: "offer_title_length",
  offer_bad_service: "offer_service_invalid",
  offer_bad_start: "offer_start_range",
  offer_bad_days: "offer_days_range",
  offer_org_overlap: "offer_org_overlap",
  offer_days_full: "offer_days_full",
  offer_not_cancellable: "offer_not_cancellable",
} as const;

export type OfferActionError =
  | (typeof DB_ERRORS)[keyof typeof DB_ERRORS]
  | "offer_owner_only"
  | "error_generic";

function toActionError(name: string, error: { message: string; code?: string }): OfferActionError {
  if (error.message.includes("not_authorized")) return "offer_owner_only";
  for (const [raised, key] of Object.entries(DB_ERRORS)) {
    if (error.message.includes(raised)) return key;
  }
  console.error(`${name} failed`, error);
  return "error_generic";
}

export async function createOfferOrder(input: {
  title: string;
  serviceId: string | null;
  start: string;
  days: number;
}): Promise<{ offerId: string } | { error: OfferActionError }> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "owner") return { error: "offer_owner_only" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_offer_order", {
      p_title: normalizeOfferTitle(input.title),
      p_service_id: input.serviceId || null,
      p_start: input.start,
      p_days: input.days,
    })
    .single();

  if (error) return { error: toActionError("create_offer_order", error) };

  revalidatePath("/offers");
  return { offerId: (data as { offer_id: string }).offer_id };
}

export async function cancelOfferOrder(offerId: string): Promise<{ error?: OfferActionError }> {
  const ctx = await requireOrgContext();
  if (ctx.role !== "owner") return { error: "offer_owner_only" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_my_offer", { p_offer_id: offerId });
  if (error) return { error: toActionError("cancel_my_offer", error) };

  revalidatePath("/offers");
  return {};
}
