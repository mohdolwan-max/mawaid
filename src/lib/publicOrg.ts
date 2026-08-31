import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { publicSupabase } from "@/lib/supabase/public";

// Cache tag for everything a clinic controls about its own public face,
// so saving the profile can drop all of it at once.
export const ORG_TAG = "public-org";

export type PublicOrg = {
  org_id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  timezone: string;
  category: string | null;
  city: string | null;
  district: string | null;
  description: string | null;
  cover_image_url: string | null;
  price_tier: number | null;
  maps_url: string | null;
};

export type PublicService = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number | null;
  photo_url: string | null;
};

// Customers pick a specialist by NAME. This used to carry the staff
// member email, which the booking page rendered straight at the
// customer — see 0022_staff_without_email.sql. Null when the owner has
// not named them yet; the UI falls back to a generic label.
export type PublicStaff = { membership_id: string; name: string | null; title: string | null };

// Wrapped in React's cache() so generateMetadata() and the page
// component (both call this for the same slug in the same request)
// share one query instead of hitting the RPC twice.
// Two layers, and they do different jobs. cache() dedupes within ONE
// render — generateMetadata() and the page body both ask for the same
// slug. unstable_cache dedupes ACROSS requests, which is where the real
// saving is: a clinic's profile is identical for every visitor, and each
// round trip to the database costs ~450ms.
const cachedPublicOrg = unstable_cache(
  async (slug: string): Promise<PublicOrg | null> => {
    const { data, error } = await publicSupabase
      .rpc("get_public_org", { p_slug: slug })
      .maybeSingle();
    if (error) {
      // PGRST116 = no rows, which is a real answer, not a failure.
      if (error.code === "PGRST116") return null;
      console.error("get_public_org failed", error);
      throw error;
    }
    return (data as PublicOrg) ?? null;
  },
  ["public-org"],
  { revalidate: 60, tags: [ORG_TAG] }
);

export const getPublicOrg = cache(async (slug: string): Promise<PublicOrg | null> => {
  try {
    return await cachedPublicOrg(slug);
  } catch {
    // A missing profile 404s the page, which is honest. Returning null on
    // a genuine failure would 404 a clinic that exists, so this is logged
    // above and surfaced as "not found" only because there is nothing
    // better a public page can do with it.
    return null;
  }
});

const cachedPublicServices = unstable_cache(
  async (slug: string): Promise<PublicService[]> => {
    const { data, error } = await publicSupabase.rpc("list_public_services", { p_org_slug: slug });
    if (error) {
      console.error("list_public_services failed", error);
      throw error;
    }
    return (data as PublicService[]) ?? [];
  },
  ["public-services"],
  { revalidate: 60, tags: [ORG_TAG] }
);

export async function listPublicServices(slug: string): Promise<PublicService[]> {
  try {
    return await cachedPublicServices(slug);
  } catch {
    return [];
  }
}

// Deliberately NOT cached. This is read while a customer is part-way
// through the wizard, right before slots are fetched — and slots are
// never cached, because availability is the one thing that must be live.
// A cached specialist list beside a live slot list could offer someone
// who is no longer bookable.
export async function listPublicStaffForService(slug: string, serviceId: string): Promise<PublicStaff[]> {
  const supabase = publicSupabase;
  const { data } = await supabase.rpc("list_public_staff_for_service", {
    p_org_slug: slug,
    p_service_id: serviceId,
  });
  return (data as PublicStaff[]) ?? [];
}
