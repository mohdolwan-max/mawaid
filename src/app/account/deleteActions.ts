"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Shared by both sides: a customer deleting from /account and a clinic
// owner deleting from /settings both hit the same RPC, which works out
// which they are from their memberships (see 0024_account_deletion.sql).

export async function requestAccountDeletion(): Promise<{ purgeAfter?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_account_deletion");
  if (error) return { error: "error_generic" };
  revalidatePath("/account");
  revalidatePath("/settings");
  return { purgeAfter: data as string };
}

export async function cancelAccountDeletion(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_account_deletion");
  if (error) return { error: "error_generic" };
  revalidatePath("/account");
  revalidatePath("/settings");
  return {};
}

// Null when no deletion is scheduled. RLS on account_deletions limits
// this to the caller's own row.
export async function getPendingDeletion(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("account_deletions")
    .select("purge_after")
    .maybeSingle();
  return (data as { purge_after: string } | null)?.purge_after ?? null;
}
