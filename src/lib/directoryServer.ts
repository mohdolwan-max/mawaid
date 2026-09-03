import "server-only";
import { unstable_cache } from "next/cache";
import { publicSupabase } from "@/lib/supabase/public";
import type { DirectoryOrg } from "@/lib/directory";

export type NearbyOrg = DirectoryOrg & { distance_km: number };

export const DIRECTORY_TAG = "directory";

// The marketplace listing is the same for everybody and changes when a
// clinic signs up, edits its profile or gets a review — not per request.
// It was being re-queried on every single page view, and one round trip
// to the database measures ~450ms, which is most of what a visitor waits
// for. Sixty seconds is short enough that a clinic editing its own
// profile sees the change almost immediately, and long enough that a
// burst of visitors costs one query rather than one each.
//
// Tagged so a write can drop it deliberately rather than waiting out the
// window — see revalidateDirectory().
const cachedListDirectoryOrgs = unstable_cache(
  async (filters: {
    city?: string | null;
    category?: string | null;
    search?: string | null;
    limit?: number;
    offset?: number;
    featuredCategories?: string[] | null;
    featuredOnly?: boolean;
    order?: "rating" | "newest";
    district?: string | null;
  }): Promise<DirectoryOrg[]> => {
    const { data, error } = await publicSupabase.rpc("list_directory_orgs", {
      p_city: filters.city ?? null,
      p_category: filters.category ?? null,
      p_search: filters.search ?? null,
      p_limit: filters.limit ?? 24,
      p_offset: filters.offset ?? 0,
      p_featured_categories: filters.featuredCategories ?? null,
      p_featured_only: filters.featuredOnly ?? false,
      // Sent only when it is not the default: an already-deployed app
      // talking to a database still on the 7-parameter function keeps
      // every rating-ordered row working, and only the newest row
      // degrades to absent (0035 unapplied logs PGRST202 below).
      ...(filters.order === "newest" ? { p_order: "newest" } : {}),
      // Same deploy-order tolerance for the district filter (0036).
      ...(filters.district ? { p_district: filters.district } : {}),
    });

    // Not `data ?? []`. An empty marketplace and a broken query look
    // identical to a visitor, and the second one needs to be visible in
    // the logs at least (ENGINEERING-STANDARDS §1). Throwing would also
    // stop a failure being cached for the next sixty seconds.
    if (error) {
      console.error("list_directory_orgs failed", error);
      throw error;
    }
    return (data as DirectoryOrg[]) ?? [];
  },
  ["list-directory-orgs"],
  { revalidate: 60, tags: [DIRECTORY_TAG] }
);

export async function listDirectoryOrgs(filters: {
  city?: string | null;
  category?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
  featuredCategories?: string[] | null;
  featuredOnly?: boolean;
  order?: "rating" | "newest";
  district?: string | null;
}): Promise<DirectoryOrg[]> {
  try {
    return await cachedListDirectoryOrgs(filters);
  } catch {
    // A failed listing must not take the whole page down with it — the
    // nav, the chips and the search box are all still useful. The error
    // is already logged above.
    return [];
  }
}

// Deliberately NOT wrapped in unstable_cache: the arguments are one
// customer's position, so a cache entry would be private to a ~110m grid
// square and hit almost never, while the query itself measured ~9ms and
// the database now sits in the same city as the functions. Caching here
// would spend memory to save nothing.
export async function listNearbyOrgs(lat: number, lng: number, limit = 12): Promise<NearbyOrg[]> {
  const { data, error } = await publicSupabase.rpc("list_nearby_orgs", {
    p_lat: lat,
    p_lng: lng,
    p_limit: limit,
  });
  if (error) {
    // 0031 not applied yet: the nearest row simply does not render,
    // which degrades exactly like the feature not existing. Anything
    // else is a real failure — logged loudly, and the row is dropped
    // rather than taking the whole home page down with it.
    if (error.code === "PGRST202") {
      console.error("list_nearby_orgs missing (0031 unapplied)");
    } else {
      console.error("list_nearby_orgs failed", error);
    }
    return [];
  }
  return (data as NearbyOrg[]) ?? [];
}

// District tiles ("browse by zone") and the open-now counter share the
// directory's caching story: same audience-wide data, same 60s window,
// same tag so a profile edit drops them together with the listings.
// Both degrade to "render nothing" when the RPC is missing (0036 not
// applied yet) or failing — a missing count must never render as 0.
const cachedDistrictCounts = unstable_cache(
  async (city: string | null): Promise<{ district: string; org_count: number }[]> => {
    const { data, error } = await publicSupabase.rpc("list_district_counts", {
      p_city: city,
    });
    if (error) {
      console.error(
        error.code === "PGRST202"
          ? "list_district_counts missing (0036 unapplied)"
          : "list_district_counts failed",
        error.code === "PGRST202" ? "" : error
      );
      throw error;
    }
    return (data as { district: string; org_count: number }[]) ?? [];
  },
  ["list-district-counts"],
  { revalidate: 60, tags: [DIRECTORY_TAG] }
);

export async function listDistrictCounts(
  city: string | null
): Promise<{ district: string; org_count: number }[]> {
  try {
    return await cachedDistrictCounts(city);
  } catch {
    return [];
  }
}

const cachedOpenNowCount = unstable_cache(
  async (city: string | null): Promise<number | null> => {
    const { data, error } = await publicSupabase.rpc("count_open_now", {
      p_city: city,
    });
    if (error) {
      console.error(
        error.code === "PGRST202"
          ? "count_open_now missing (0036 unapplied)"
          : "count_open_now failed",
        error.code === "PGRST202" ? "" : error
      );
      throw error;
    }
    return typeof data === "number" ? data : null;
  },
  ["count-open-now"],
  // 60s is coarse against a clock ("open at 9:00" can read closed until
  // 9:01) but that is one minute of staleness on a convenience line —
  // not worth a per-request query.
  { revalidate: 60, tags: [DIRECTORY_TAG] }
);

export async function countOpenNow(city: string | null): Promise<number | null> {
  try {
    return await cachedOpenNowCount(city);
  } catch {
    // null, not 0: the caller hides the line entirely. "0 clinics open"
    // is a real fact we do show; "the query broke" is not.
    return null;
  }
}
