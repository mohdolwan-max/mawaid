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

  // Optional link: when the owner invites someone who is ALREADY listed
  // by name, the invite claims that row on acceptance instead of creating
  // a second bookable copy of the same person (see 0022).
  const membershipId = String(formData.get("membershipId") ?? "").trim();
  await supabase.rpc("invite_staff", {
    p_org_id: ctx.orgId,
    p_email: email,
    p_role: "staff",
    p_membership_id: membershipId || null,
  });
  revalidatePath("/staff");
}

// The primary way to add someone: a name (and optionally a phone for
// the owner own reference). No email, no account, no waiting for them
// to sign up — see 0022_staff_without_email.sql.
export async function addStaffMember(formData: FormData) {
  await requireOrgContext();
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "required_field" as const };
  const phone = String(formData.get("phone") ?? "").trim();

  const title = String(formData.get("title") ?? "").trim();

  const { error } = await supabase.rpc("add_staff_member", {
    p_name: name,
    p_title: title || null,
    p_phone: phone || null,
  });
  if (error) return { error: "error_generic" as const };

  revalidatePath("/staff");
  return {};
}

export async function removeStaffMember(membershipId: string) {
  await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_staff_member", { p_membership_id: membershipId });
  if (error) {
    // The RPC refuses rather than cascading away real bookings.
    return { error: error.message.includes("staff_has_bookings") ? ("staff_has_bookings" as const) : ("error_generic" as const) };
  }
  revalidatePath("/staff");
  return {};
}

// update_staff_profile has existed since 0013 but was never called from
// anywhere, which is why every membership still has display_name NULL and
// the public staff picker had nothing to show but the email address.
export async function renameStaffMember(membershipId: string, name: string, title: string, phone: string) {
  await requireOrgContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_staff_profile", {
    p_membership_id: membershipId,
    p_display_name: name.trim() || null,
    p_title: title.trim() || null,
    p_phone: phone.trim() || null,
  });
  if (error) return { error: "error_generic" as const };
  revalidatePath("/staff");
  return {};
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
