import "server-only";
import { cookies, headers } from "next/headers";
import type { CityKey } from "@/lib/directory";
import { defaultCity, isListedCity } from "@/lib/markets";
import { getMarkets } from "@/lib/marketsServer";

// Namespaced for the same localhost-port-sharing reason as LANG_COOKIE
// (src/lib/lang.ts).
export const CITY_COOKIE = "mawaid_city";

/** The visitor's city: the one they picked, while its country is shown to
 *  customers; otherwise one in the country their connection comes from
 *  (Vercel's IP country header, no location permission asked). */
export async function getCity(): Promise<CityKey> {
  const markets = await getMarkets();
  const value = (await cookies()).get(CITY_COOKIE)?.value;
  if (isListedCity(markets, value)) return value as CityKey;
  const ipCountry = (await headers()).get("x-vercel-ip-country");
  return defaultCity(markets, ipCountry) ?? "amman";
}
