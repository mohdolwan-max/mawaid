import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DirectoryOrg } from "@/lib/directory";

export async function listDirectoryOrgs(filters: {
  city?: string | null;
  category?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
  featuredCategories?: string[] | null;
  /** true = hard-restrict to featuredCategories (home rows); false =
   *  featuredCategories only nudges ordering (search), never filters. */
  featuredOnly?: boolean;
}): Promise<DirectoryOrg[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_directory_orgs", {
    p_city: filters.city ?? null,
    p_category: filters.category ?? null,
    p_search: filters.search ?? null,
    p_limit: filters.limit ?? 24,
    p_offset: filters.offset ?? 0,
    p_featured_categories: filters.featuredCategories ?? null,
    p_featured_only: filters.featuredOnly ?? false,
  });
  return (data as DirectoryOrg[]) ?? [];
}
