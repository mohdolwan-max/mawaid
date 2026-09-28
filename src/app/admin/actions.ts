"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { ADMIN_COUNTRY_COOKIE } from "@/lib/adminCountry";
import { countryOfCity } from "@/lib/directory";
import { DIRECTORY_TAG } from "@/lib/directoryServer";
import { PLANS_TAG } from "@/lib/planServer";
import { createClient } from "@/lib/supabase/server";
import { isPlanId } from "@/lib/plan";
import { reasonOk } from "@/lib/admin";
import { paymentsReady } from "@/lib/payments";
import { MARKETS_TAG, getMarkets } from "@/lib/marketsServer";

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
  | "admin_err_country"
  | "admin_err_city_country"
  | "admin_err_market_not_ready"
  | "admin_err_open_needs_prices"
  | "admin_err_price"
  | "admin_err_offer_settings"
  | "error_generic";

const DB_ERRORS: [string, AdminActionError][] = [
  ["not_authorized", "admin_err_not_admin"],
  ["admin_reason_required", "admin_err_reason"],
  ["admin_not_trial", "admin_err_not_trial"],
  ["admin_org_closed", "admin_err_org_closed"],
  ["admin_not_refundable", "admin_err_not_refundable"],
  ["admin_offer_not_removable", "admin_err_offer_not_removable"],
  ["admin_bad_country", "admin_err_country"],
  ["org_city_country", "admin_err_city_country"],
  ["market_not_ready", "admin_err_market_not_ready"],
  ["market_open_needs_prices", "admin_err_open_needs_prices"],
  ["price_bad_input", "admin_err_price"],
  ["offer_settings_bad_input", "admin_err_offer_settings"],
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

// ---------------------------------------------------------------------
// Countries (0056)
// ---------------------------------------------------------------------

/** The country every admin page shows; null = all countries. Remembered
 *  per browser. The database still checks the code on every call. */
export async function setAdminCountry(code: string | null): Promise<void> {
  const store = await cookies();
  if (code && /^[A-Z]{2}$/.test(code)) {
    store.set(ADMIN_COUNTRY_COOKIE, code, { path: "/admin", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  } else {
    store.delete({ name: ADMIN_COUNTRY_COOKIE, path: "/admin" });
  }
  revalidatePath("/admin", "layout");
}

/** Moves a clinic to another country and city. Its saved card stops (it
 *  belongs to the old country's gateway account); the database logs it. */
export async function adminMoveOrgCountry(input: {
  orgId: string;
  country: string;
  city: string;
  reason: string;
}): Promise<{ error?: AdminActionError }> {
  if (!reasonOk(input.reason)) return { error: "admin_err_reason" };
  if (input.city && countryOfCity(input.city) !== input.country) return { error: "admin_err_city_country" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_move_org_country", {
    p_org_id: input.orgId,
    p_country: input.country,
    p_city: input.city || null,
    p_reason: input.reason.trim(),
  });
  if (error) return { error: toError("admin_move_org_country", error) };
  revalidateTag(DIRECTORY_TAG);
  return done();
}

/** Opening a country for sign-up is refused by the database until it has
 *  prices, offer settings and a tax registration; the gateway keys are
 *  checked by the page, which can see the environment. */
export async function adminSaveMarket(input: {
  code: string;
  signupOpen: boolean;
  listed: boolean;
  reason: string;
}): Promise<{ error?: AdminActionError }> {
  if (!reasonOk(input.reason)) return { error: "admin_err_reason" };
  // The database cannot see the gateway keys; opening a country without
  // them would let clinics sign up to a plan nobody can pay for.
  const wasOpen = (await getMarkets()).find((m) => m.code === input.code)?.signupOpen === true;
  if (input.signupOpen && !wasOpen && !paymentsReady(input.code)) return { error: "admin_err_market_not_ready" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_market", {
    p_code: input.code,
    p_signup_open: input.signupOpen,
    p_listed: input.listed,
    p_reason: input.reason.trim(),
  });
  if (error) return { error: toError("admin_save_market", error) };
  // Which countries customers see changes the city picker and listings.
  revalidateTag(MARKETS_TAG);
  revalidateTag(DIRECTORY_TAG);
  revalidatePath("/", "layout");
  return done();
}

/** Both prices null takes the plan off sale in that country. */
export async function adminSavePlanPrice(input: {
  planId: string;
  country: string;
  priceMonth: number | null;
  priceYear: number | null;
  reason: string;
}): Promise<{ error?: AdminActionError }> {
  if (!reasonOk(input.reason)) return { error: "admin_err_reason" };
  if (!isPlanId(input.planId)) return { error: "error_generic" };
  if ((input.priceMonth === null) !== (input.priceYear === null)) return { error: "admin_err_price" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_plan_price", {
    p_plan: input.planId,
    p_country: input.country,
    p_price_month: input.priceMonth,
    p_price_year: input.priceYear,
    p_reason: input.reason.trim(),
  });
  if (error) return { error: toError("admin_save_plan_price", error) };
  revalidateTag(PLANS_TAG);
  return done();
}

export async function adminSaveOfferSettings(input: {
  country: string;
  pricePerDay: number;
  slotsPerDay: number;
  maxDays: number;
  maxAdvanceDays: number;
  holdMinutes: number;
  reason: string;
}): Promise<{ error?: AdminActionError }> {
  if (!reasonOk(input.reason)) return { error: "admin_err_reason" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_offer_settings", {
    p_country: input.country,
    p_price_per_day: input.pricePerDay,
    p_slots_per_day: input.slotsPerDay,
    p_max_days: input.maxDays,
    p_max_advance_days: input.maxAdvanceDays,
    p_hold_minutes: input.holdMinutes,
    p_reason: input.reason.trim(),
  });
  return error ? { error: toError("admin_save_offer_settings", error) } : done();
}
