"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";
import type { BusinessHours } from "@/lib/types";

export async function inviteStaff(formData: FormData) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;

  await supabase.rpc("invite_staff", { p_org_id: ctx.orgId, p_email: email, p_role: "staff" });
  revalidatePath("/staff");
}

export async function toggleStaffService(staffMembershipId: string, serviceId: string, assigned: boolean) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  if (assigned) {
    await supabase
      .from("staff_services")
      .delete()
      .eq("staff_membership_id", staffMembershipId)
      .eq("service_id", serviceId);
  } else {
    await supabase.from("staff_services").insert({
      org_id: ctx.orgId,
      staff_membership_id: staffMembershipId,
      service_id: serviceId,
    });
  }
  revalidatePath("/staff");
}

// null businessHours = revert to inheriting the org's hours.
export async function saveStaffSchedule(membershipId: string, businessHours: BusinessHours | null) {
  await requireOrgContext();
  const supabase = await createClient();
  await supabase.rpc("update_staff_schedule", { p_membership_id: membershipId, p_business_hours: businessHours });
  revalidatePath("/staff");
}

export async function addTimeOff(input: {
  membershipId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
}) {
  await requireOrgContext();
  const supabase = await createClient();
  await supabase.rpc("add_staff_time_off", {
    p_membership_id: input.membershipId,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_reason: input.reason || null,
  });
  revalidatePath("/staff");
}

export async function removeTimeOff(id: string) {
  await requireOrgContext();
  const supabase = await createClient();
  await supabase.rpc("remove_staff_time_off", { p_id: id });
  revalidatePath("/staff");
}
