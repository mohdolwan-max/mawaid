"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/org";

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
