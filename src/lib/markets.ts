// Countries ("markets", 0056). Client-importable: the sign-up wizard and
// the city picker use these with the list the server loaded.

import type { Lang } from "@/lib/i18n";
import { CITIES, type CityKey } from "@/lib/directory";

export type Market = {
  code: string;
  nameAr: string;
  nameEn: string;
  currency: string;
  dialCode: string;
  /** New clinics may choose it. */
  signupOpen: boolean;
  /** Customers see its clinics. */
  listed: boolean;
  sort: number;
};

export function marketName(m: Pick<Market, "nameAr" | "nameEn">, lang: Lang): string {
  return lang === "ar" ? m.nameAr : m.nameEn;
}

export function marketByCode(markets: readonly Market[], code: string | null | undefined): Market | null {
  return markets.find((m) => m.code === code) ?? null;
}

/** Cities customers can pick, country by country in the markets' order. */
export function listedCities(markets: readonly Market[]): typeof CITIES {
  return markets.filter((m) => m.listed).flatMap((m) => CITIES.filter((c) => c.country === m.code));
}

export function isListedCity(markets: readonly Market[], city: string | null | undefined): boolean {
  return listedCities(markets).some((c) => c.key === city);
}

export function signupMarkets(markets: readonly Market[]): Market[] {
  return markets.filter((m) => m.signupOpen);
}

/** Whose prices the clinic pricing page shows: the visitor's own country
 *  when clinics can sign up there, otherwise the first country that is
 *  open, so a visitor from elsewhere still sees real prices. */
export function pricingMarket(markets: readonly Market[], ipCountry: string | null | undefined): Market | null {
  const open = signupMarkets(markets);
  const code = ipCountry?.trim().toUpperCase();
  return open.find((m) => m.code === code) ?? open[0] ?? null;
}

/** Where a visitor starts before choosing a city (owner, 2026-09-28: the
 *  customer's country comes from where they are). The first city of the
 *  country their connection is in, when customers are shown that country;
 *  otherwise the first city of the first country that is shown. Null only
 *  when no country is shown at all. */
export function defaultCity(markets: readonly Market[], ipCountry: string | null | undefined): CityKey | null {
  const shown = listedCities(markets);
  const code = ipCountry?.trim().toUpperCase();
  const local = code ? shown.find((c) => c.country === code) : undefined;
  return (local ?? shown[0])?.key ?? null;
}
