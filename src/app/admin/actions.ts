"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isPlanId } from "@/lib/plan";
import { reasonOk } from "@/lib/admin";

// Each tool is a database function that checks the caller is a platform
// admin, needs a typed reason and writes admin_actions (0049). These only
// pass the request through and name the refusal.

export type AdminActionError =
  | "admin_err_not_admin"
  | "admin_err_reason"
  | "admin_err_not_trial"
  | "admin_err_org_closed"
  | "admin_err_not_refundable"
  | "admin_err_offer_not_removable"
  | "error_generic";

const DB_ERRORS: [string, AdminActionError][] = [
  ["not_authorized", "admin_err_not_admin"],
  ["admin_reason_required", "admin_err_reason"],
  ["admin_not_trial", "admin_err_not_trial"],
  ["admin_org_closed", "admin_err_org_closed"],
  ["admin_not_refundable", "admin_err_not_refundable"],
  ["admin_offer_not_removable", "admin_err_offer_not_removable"],
];

function toError(name: string, error: { message: string }): AdminActionError {
  for (const [raised, key] of DB_ERRORS) {
    if (error.message.includes(raised)) return key;
  }
  console.error(`${name} failed`, error);
  return "error_generic";
}

function done(): { error?: AdminActionError } {
  revalidatePath("/admin", "layout");
  return {};
}

export async function adminSetPlan(input: {
  orgId: string;
  planId: string;
  /** null = no end date */
  months: number | null;
  reason: string;
}): Promise<{ error?: AdminActionError }> {
  if (!reasonOk(input.reason)) return { error: "admin_err_reason" };
  if (!isPlanId(input.planId)) return { error: "error_generic" };
  if (input.months !== null && (!Number.isInteger(input.months) || input.months < 1 || input.months > 36)) {
    return { error: "error_generic" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_plan", {
    p_org_id: input.orgId,
    p_plan: input.planId,
    p_months: input.months,
    p_reason: input.reason.trim(),
  });
  return error ? { error: toError("admin_set_plan", error) } : done();
}

export async function adminExtendTrial(input: {
  orgId: string;
  days: number;
  reason: string;
}): Promise<{ error?: AdminActionError }> {
  if (!reasonOk(input.reason)) return { error: "admin_err_reason" };
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 60) return { error: "error_generic" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_extend_trial", {
    p_org_id: input.orgId,
    p_days: input.days,
    p_reason: input.reason.trim(),
  });
  return error ? { error: toError("admin_extend_trial", error) } : done();
}

export async function adminMarkRefunded(input: { paymentId: string; note: string }): Promise<{ error?: AdminActionError }> {
  if (!reasonOk(input.note)) return { error: "admin_err_reason" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_mark_refunded", {
    p_payment_id: input.paymentId,
    p_note: input.note.trim(),
  });
  return error ? { error: toError("admin_mark_refunded", error) } : done();
}

export async function adminRemoveOffer(input: { offerId: string; reason: string }): Promise<{ error?: AdminActionError }> {
  if (!reasonOk(input.reason)) return { error: "admin_err_reason" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_remove_offer", {
    p_offer_id: input.offerId,
    p_reason: input.reason.trim(),
  });
  if (error) return { error: toError("admin_remove_offer", error) };
  // The banner leaves the home page: its cache is tagged "offers".
  revalidatePath("/", "layout");
  return done();
}
