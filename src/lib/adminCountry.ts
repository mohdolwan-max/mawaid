import "server-only";
import { cookies } from "next/headers";
import type { Market } from "@/lib/markets";

// The country the admin pages are looking at (0056), remembered per
// browser so it holds across every admin page and period, the way the
// branch switcher does in Mahsoob. Unset or unknown = all countries.
export const ADMIN_COUNTRY_COOKIE = "mawaid_admin_country";

/** null = all countries. */
export async function getAdminCountry(markets: readonly Market[]): Promise<string | null> {
  const value = (await cookies()).get(ADMIN_COUNTRY_COOKIE)?.value;
  return markets.some((m) => m.code === value) ? (value as string) : null;
}
