"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Takes an entry off the clinic's waitlist (0066). The RPC decides who the
// caller is and which clinic they belong to.
export async function removeWaitlistAction(id: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_waitlist_entry", { p_id: id });
  if (error) {
    console.error("remove_waitlist_entry failed", error);
    return { ok: false };
  }
  revalidatePath("/waitlist");
  return { ok: true };
}
