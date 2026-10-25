"use server";

import { createClient } from "@/lib/supabase/server";

// The member's calendar link (0070): the live one, or a new one when
// `reset` (the old one stops working at once). The RPC decides who the
// caller is and whether they may take the whole clinic's.
export async function calendarFeedAction(
  scope: "me" | "clinic",
  reset: boolean
): Promise<{ ok: true; token: string } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_calendar_feed", { p_scope: scope, p_reset: reset });
  if (error || typeof data !== "string") {
    if (error) console.error("my_calendar_feed failed", error);
    return { ok: false };
  }
  return { ok: true, token: data };
}
