"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";

export async function markNotificationsRead() {
  await requireOrgContext();
  const supabase = await createClient();
  await supabase.rpc("mark_notifications_read");
  revalidatePath("/dashboard");
}
