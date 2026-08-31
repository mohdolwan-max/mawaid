import "server-only";
import { unstable_cache } from "next/cache";
import { publicSupabase } from "@/lib/supabase/public";
import type { DirectoryOrg } from "@/lib/directory";

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
  }): Promise<DirectoryOrg[]> => {
    const { data, error } = await publicSupabase.rpc("list_directory_orgs", {
      p_city: filters.city ?? null,
      p_category: filters.category ?? null,
      p_search: filters.search ?? null,
      p_limit: filters.limit ?? 24,
      p_offset: filters.offset ?? 0,
      p_featured_categories: filters.featuredCategories ?? null,
      p_featured_only: filters.featuredOnly ?? false,
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
