"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";
import type { BusinessHours } from "@/lib/types";

export async function saveOrgProfile(input: { name: string; address: string; phone: string }) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();
  await supabase
    .from("organizations")
    .update({
      name: input.name.trim(),
      address: input.address.trim() || null,
      phone: input.phone.trim() || null,
    })
    .eq("id", ctx.orgId);
  revalidatePath("/settings");
}

export async function saveBookingRules(input: {
  businessHours: BusinessHours;
  slotIntervalMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
}) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();
  await supabase
    .from("org_settings")
    .update({
      business_hours: input.businessHours,
      slot_interval_minutes: input.slotIntervalMinutes,
      min_notice_minutes: input.minNoticeMinutes,
      max_advance_days: input.maxAdvanceDays,
    })
    .eq("org_id", ctx.orgId);
  revalidatePath("/settings");
}
