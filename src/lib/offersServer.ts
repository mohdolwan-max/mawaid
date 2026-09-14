import "server-only";
import { unstable_cache } from "next/cache";
import { publicSupabase } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import {
  isOfferState,
  type ActiveBanner,
  type DayAvailability,
  type MyOffer,
  type OfferSetup,
} from "@/lib/offers";

export const OFFERS_TAG = "offers";

function logRpcError(name: string, error: { code?: string }) {
  if (error.code === "PGRST202") {
    console.error(`${name} missing (0045 unapplied)`);
  } else {
    console.error(`${name} failed`, error);
  }
}

type SetupRow = {
  org_name: string;
  org_slug: string;
  logo_url: string | null;
  cover_image_url: string | null;
  city: string | null;
  is_listed: boolean;
  today: string;
  timezone: string;
  price_per_day_jod: number | string;
  slots_per_day: number;
  max_days: number;
  max_advance_days: number;
  hold_minutes: number;
  /** Absent before 0046; read as no end. */
  last_offer_day?: string | null;
};

/** null when it cannot be read — the page then says so instead of
 *  showing a price or free days it does not have. */
export async function getOfferSetup(): Promise<OfferSetup | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("offer_setup").maybeSingle();
  if (error) {
    logRpcError("offer_setup", error);
    return null;
  }
  const r = data as SetupRow | null;
  if (!r) return null;
  const price = Number(r.price_per_day_jod);
  if (!Number.isFinite(price)) return null;
  return {
    orgName: r.org_name,
    orgSlug: r.org_slug,
    logoUrl: r.logo_url,
    coverUrl: r.cover_image_url,
    city: r.city,
    isListed: r.is_listed,
    today: r.today,
    timezone: r.timezone,
    pricePerDayJod: price,
    slotsPerDay: r.slots_per_day,
    maxDays: r.max_days,
    maxAdvanceDays: r.max_advance_days,
    holdMinutes: r.hold_minutes,
    lastOfferDay: r.last_offer_day ?? null,
  };
}

export async function getOfferAvailability(): Promise<DayAvailability[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("offer_availability");
  if (error) {
    logRpcError("offer_availability", error);
    return null;
  }
  return ((data as { day: string; taken: number; mine: boolean }[]) ?? []).map((r) => ({
    day: r.day,
    taken: r.taken,
    mine: r.mine,
  }));
}

type MyOfferRow = {
  id: string;
  title: string;
  service_name: string | null;
  city: string;
  start_date: string;
  end_date: string;
  days: number;
  price_per_day_jod: number | string;
  total_jod: number | string;
  state: string;
  hold_expires_at: string;
  paid_at: string | null;
  created_at: string;
};

export async function listMyOffers(): Promise<MyOffer[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_offers");
  if (error) {
    logRpcError("list_my_offers", error);
    return null;
  }
  return ((data as MyOfferRow[]) ?? [])
    .filter((r) => isOfferState(r.state))
    .map((r) => ({
      id: r.id,
      title: r.title,
      serviceName: r.service_name,
      city: r.city,
      startDate: r.start_date,
      endDate: r.end_date,
      days: r.days,
      pricePerDayJod: Number(r.price_per_day_jod),
      totalJod: Number(r.total_jod),
      state: r.state as MyOffer["state"],
      holdExpiresAt: r.hold_expires_at,
      paidAt: r.paid_at,
      createdAt: r.created_at,
    }));
}

type BannerRow = {
  offer_id: string;
  title: string;
  org_name: string;
  org_slug: string;
  logo_url: string | null;
  cover_image_url: string | null;
  service_id: string | null;
  service_name: string | null;
  service_photo_url: string | null;
};

// The same for every visitor in a city. A minute of cache means a newly
// paid offer appears within a minute, and a day's offers roll over within
// a minute of midnight.
const cachedBanners = unstable_cache(
  async (city: string): Promise<ActiveBanner[]> => {
    const { data, error } = await publicSupabase.rpc("list_active_banners", { p_city: city });
    if (error) {
      logRpcError("list_active_banners", error);
      // Thrown so a failure is not cached as "no offers today".
      throw error;
    }
    return ((data as BannerRow[]) ?? []).map((r) => ({
      offerId: r.offer_id,
      title: r.title,
      orgName: r.org_name,
      orgSlug: r.org_slug,
      logoUrl: r.logo_url,
      coverUrl: r.cover_image_url,
      serviceId: r.service_id,
      serviceName: r.service_name,
      servicePhotoUrl: r.service_photo_url,
    }));
  },
  ["active-banners"],
  { revalidate: 60, tags: [OFFERS_TAG] }
);

/** Empty on failure: the banner is simply absent, and nothing on the home
 *  page claims there are no offers. */
export async function listActiveBanners(city: string): Promise<ActiveBanner[]> {
  try {
    return await cachedBanners(city);
  } catch {
    return [];
  }
}
