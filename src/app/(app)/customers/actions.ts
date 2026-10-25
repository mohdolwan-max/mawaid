"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { normalizePhone } from "@/lib/phone";
import { cleanTags } from "@/lib/customerFile";

// The customer file's writes (0062). Each RPC decides who the caller is
// and which clinic they belong to; nothing here passes a clinic id.

type Result = { ok: true } | { ok: false; error: "cust_tags_invalid" | "cust_note_length" | "error_generic" };

const fileUrl = (phone: string) => `/customers/${encodeURIComponent(normalizePhone(phone))}`;

export async function addCustomerNoteAction(phone: string, body: string): Promise<Result> {
  if (body.trim().length < 1 || body.trim().length > 2000) return { ok: false, error: "cust_note_length" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_customer_note", { p_phone: phone, p_body: body });
  if (error) {
    if (error.message?.includes("note_length")) return { ok: false, error: "cust_note_length" };
    console.error("add_customer_note failed", error);
    return { ok: false, error: "error_generic" };
  }
  revalidatePath(fileUrl(phone));
  return { ok: true };
}

export async function deleteCustomerNoteAction(phone: string, noteId: string): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_customer_note", { p_note_id: noteId });
  if (error) {
    console.error("delete_customer_note failed", error);
    return { ok: false, error: "error_generic" };
  }
  revalidatePath(fileUrl(phone));
  return { ok: true };
}

export async function setCustomerTagsAction(phone: string, input: string): Promise<Result> {
  const { tags, ok } = cleanTags(input);
  if (!ok) return { ok: false, error: "cust_tags_invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_customer_tags", { p_phone: phone, p_tags: tags });
  if (error) {
    if (error.message?.includes("tags_invalid")) return { ok: false, error: "cust_tags_invalid" };
    console.error("set_customer_tags failed", error);
    return { ok: false, error: "error_generic" };
  }
  revalidatePath(fileUrl(phone));
  revalidatePath("/customers");
  return { ok: true };
}

// ---- Session packages (0064) ------------------------------------------------

export type PackageActionError =
  | "package_err_price"
  | "package_err_refund"
  | "package_err_note"
  | "package_err_gone"
  | "package_err_used_up"
  | "package_err_expired"
  | "package_err_cancelled"
  | "error_generic";

type PackageResult = { ok: true } | { ok: false; error: PackageActionError };

// The database's refusal, in words the desk can act on. Anything else is
// logged and shown as the generic failure.
function packageError(message: string | undefined, fallbackLog: string, error: unknown): PackageActionError {
  const m = message ?? "";
  if (m.includes("package_price")) return "package_err_price";
  if (m.includes("package_refund")) return "package_err_refund";
  if (m.includes("package_note")) return "package_err_note";
  if (m.includes("package_used_up")) return "package_err_used_up";
  if (m.includes("package_expired")) return "package_err_expired";
  if (m.includes("package_cancelled")) return "package_err_cancelled";
  if (m.includes("package_not_found") || m.includes("visit_not_found") || m.includes("visit_not_finished")) return "package_err_gone";
  console.error(fallbackLog, error);
  return "error_generic";
}

export async function sellPackageAction(phone: string, packageId: string, price: number, note: string): Promise<PackageResult> {
  if (!Number.isFinite(price) || price < 0) return { ok: false, error: "package_err_price" };
  if (note.length > 500) return { ok: false, error: "package_err_note" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sell_customer_package", {
    p_phone: phone,
    p_package_id: packageId,
    p_price: price,
    p_note: note.trim() || null,
  });
  if (error) return { ok: false, error: packageError(error.message, "sell_customer_package failed", error) };
  revalidatePath(fileUrl(phone));
  revalidatePath("/customers");
  return { ok: true };
}

export async function cancelPackageAction(phone: string, customerPackageId: string, refund: number): Promise<PackageResult> {
  if (!Number.isFinite(refund) || refund < 0) return { ok: false, error: "package_err_refund" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_customer_package", { p_id: customerPackageId, p_refund: refund });
  if (error) return { ok: false, error: packageError(error.message, "cancel_customer_package failed", error) };
  revalidatePath(fileUrl(phone));
  revalidatePath("/customers");
  return { ok: true };
}

/** customerPackageId null takes the visit off any package for good. */
export async function setVisitPackageAction(
  phone: string,
  appointmentId: string,
  customerPackageId: string | null
): Promise<PackageResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_visit_package", {
    p_appointment_id: appointmentId,
    p_customer_package_id: customerPackageId,
  });
  if (error) return { ok: false, error: packageError(error.message, "set_visit_package failed", error) };
  revalidatePath(fileUrl(phone));
  revalidatePath("/customers");
  return { ok: true };
}

// ---- Importing customers (0073) ----------------------------------------------------

export type ImportResult =
  | { ok: true; added: number; updated: number; skipped: { row: number; reason: string }[] }
  | { ok: false; error: "error_generic" | "import_err_too_many" };

/** Sends the rows the preview accepted; the database checks each again
 *  and returns, by position in this list, any it did not take and why. */
export async function importCustomersAction(
  rows: { name: string; phone: string; email: string; notes: string; tags: string[] }[]
): Promise<ImportResult> {
  if (rows.length > 2000) return { ok: false, error: "import_err_too_many" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_customers", { p_rows: rows });
  if (error) {
    if (error.message?.includes("import_too_many")) return { ok: false, error: "import_err_too_many" };
    console.error("import_customers failed", error);
    return { ok: false, error: "error_generic" };
  }
  const d = (data ?? {}) as { added?: number; updated?: number; skipped?: { row: number; reason: string }[] };
  revalidatePath("/customers");
  return { ok: true, added: Number(d.added ?? 0), updated: Number(d.updated ?? 0), skipped: Array.isArray(d.skipped) ? d.skipped : [] };
}
