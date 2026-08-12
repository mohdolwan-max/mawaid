import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PublicOrg = {
  org_id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  timezone: string;
};

export type PublicService = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number | null;
};

export type PublicStaff = { membership_id: string; email: string };

export async function getPublicOrg(slug: string): Promise<PublicOrg | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_org", { p_slug: slug }).maybeSingle();
  return (data as PublicOrg) ?? null;
}

export async function listPublicServices(slug: string): Promise<PublicService[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_public_services", { p_org_slug: slug });
  return (data as PublicService[]) ?? [];
}

export async function listPublicStaffForService(slug: string, serviceId: string): Promise<PublicStaff[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_public_staff_for_service", {
    p_org_slug: slug,
    p_service_id: serviceId,
  });
  return (data as PublicStaff[]) ?? [];
}
