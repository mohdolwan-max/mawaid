import "server-only";
import { cookies } from "next/headers";
import { CITIES, type CityKey } from "@/lib/directory";

// Namespaced for the same localhost-port-sharing reason as LANG_COOKIE
// (src/lib/lang.ts).
export const CITY_COOKIE = "mawaid_city";

export async function getCity(): Promise<CityKey> {
  const store = await cookies();
  const value = store.get(CITY_COOKIE)?.value;
  return CITIES.some((c) => c.key === value) ? (value as CityKey) : "riyadh";
}
