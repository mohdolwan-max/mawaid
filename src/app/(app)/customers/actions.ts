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
