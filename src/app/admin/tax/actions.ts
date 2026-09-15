"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { reasonOk } from "@/lib/admin";
import { parseRate, registrationErrors, type RegistrationInput } from "@/lib/taxReport";

// Tax registration tools (0050). Like the other admin tools, the database
// checks the caller is an admin, needs a typed reason and logs the change;
// these only pass the request through and name the refusal.

export type TaxActionError =
  | "admin_err_not_admin"
  | "admin_err_reason"
  | "admin_err_tax_input"
  | "admin_err_tax_timezone"
  | "admin_err_tax_locked"
  | "admin_err_tax_prefix_taken"
  | "admin_err_tax_currency_taken"
  | "admin_err_tax_no_registration"
  | "error_generic";

const DB_ERRORS: [string, TaxActionError][] = [
  ["not_authorized", "admin_err_not_admin"],
  ["admin_reason_required", "admin_err_reason"],
  ["tax_bad_timezone", "admin_err_tax_timezone"],
  ["tax_locked_fields", "admin_err_tax_locked"],
  ["tax_prefix_taken", "admin_err_tax_prefix_taken"],
  ["tax_currency_taken", "admin_err_tax_currency_taken"],
  ["tax_bad_input", "admin_err_tax_input"],
  ["tax_no_registration", "admin_err_tax_no_registration"],
];

function toError(name: string, error: { message: string }): TaxActionError {
  for (const [raised, key] of DB_ERRORS) {
    if (error.message.includes(raised)) return key;
  }
  console.error(`${name} failed`, error);
  return "error_generic";
}

function done(): { error?: TaxActionError } {
  revalidatePath("/admin", "layout");
  return {};
}

export async function adminSaveTaxRegistration(input: {
  id: string | null;
  values: RegistrationInput;
  reason: string;
}): Promise<{ error?: TaxActionError }> {
  if (!reasonOk(input.reason)) return { error: "admin_err_reason" };
  const v = input.values;
  const rate = parseRate(v.taxRate);
  if (registrationErrors(v).length > 0 || rate === null) return { error: "admin_err_tax_input" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_tax_registration", {
    p_id: input.id,
    p_country: v.country.trim().toUpperCase(),
    p_currency: v.currency.trim().toUpperCase(),
    p_legal_name: v.legalName.trim(),
    p_tax_number: v.taxNumber.trim(),
    p_address: v.address.trim(),
    p_tax_rate: rate,
    p_timezone: v.timezone.trim(),
    p_invoice_prefix: v.invoicePrefix.trim().toUpperCase(),
    p_active: v.active,
    p_reason: input.reason.trim(),
  });
  return error ? { error: toError("admin_save_tax_registration", error) } : done();
}

export async function adminInvoiceUnassigned(input: {
  currency: string;
  reason: string;
}): Promise<{ error?: TaxActionError; invoiced?: number }> {
  if (!reasonOk(input.reason)) return { error: "admin_err_reason" };
  if (!/^[A-Z]{3}$/.test(input.currency)) return { error: "error_generic" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_invoice_unassigned", {
    p_currency: input.currency,
    p_reason: input.reason.trim(),
  });
  if (error) return { error: toError("admin_invoice_unassigned", error) };
  revalidatePath("/admin", "layout");
  return { invoiced: typeof data === "number" ? data : undefined };
}
