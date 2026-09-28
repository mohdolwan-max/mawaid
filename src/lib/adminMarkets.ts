// The admin countries page (0056): shapes and parsing. Free of React and
// the database so it can be tested directly.
//
// A price the database did not return is null and prints "—": a country
// that does not sell a plan must never read as selling it for 0.

import { num } from "@/lib/admin";

/** What a country still needs before it can open for sign-up. */
export type MarketMissing = "plan_prices" | "offer_settings" | "tax_registration";

export type AdminMarket = {
  code: string;
  nameAr: string;
  nameEn: string;
  currency: string;
  timezone: string;
  dialCode: string;
  signupOpen: boolean;
  listed: boolean;
  missing: MarketMissing[];
  clinics: number | null;
  prices: { planId: string; priceMonth: number | null; priceYear: number | null }[];
  offer: {
    pricePerDay: number;
    slotsPerDay: number;
    maxDays: number;
    maxAdvanceDays: number;
    holdMinutes: number;
  } | null;
  taxRegistration: { id: string; legalName: string; taxNumber: string; taxRate: number | null } | null;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const MISSING = new Set<MarketMissing>(["plan_prices", "offer_settings", "tax_registration"]);

/** null when the payload is not a list of countries at all; a malformed
 *  country inside it is skipped rather than shown half-read. */
export function parseAdminMarkets(raw: unknown): AdminMarket[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AdminMarket[] = [];
  for (const m of raw) {
    if (!isObj(m)) continue;
    const code = str(m.code);
    const currency = str(m.currency);
    if (!code || !/^[A-Z]{2}$/.test(code) || !currency) continue;

    const prices: AdminMarket["prices"] = [];
    for (const p of Array.isArray(m.prices) ? m.prices : []) {
      if (!isObj(p) || !str(p.plan_id)) continue;
      prices.push({ planId: p.plan_id as string, priceMonth: num(p.price_month), priceYear: num(p.price_year) });
    }

    let offer: AdminMarket["offer"] = null;
    if (isObj(m.offer)) {
      const pricePerDay = num(m.offer.price_per_day);
      const slotsPerDay = num(m.offer.slots_per_day);
      const maxDays = num(m.offer.max_days);
      const maxAdvanceDays = num(m.offer.max_advance_days);
      const holdMinutes = num(m.offer.hold_minutes);
      if (pricePerDay !== null && slotsPerDay !== null && maxDays !== null && maxAdvanceDays !== null && holdMinutes !== null) {
        offer = { pricePerDay, slotsPerDay, maxDays, maxAdvanceDays, holdMinutes };
      }
    }

    let taxRegistration: AdminMarket["taxRegistration"] = null;
    if (isObj(m.tax_registration) && str(m.tax_registration.id)) {
      taxRegistration = {
        id: m.tax_registration.id as string,
        legalName: str(m.tax_registration.legal_name) ?? "—",
        taxNumber: str(m.tax_registration.tax_number) ?? "—",
        taxRate: num(m.tax_registration.tax_rate),
      };
    }

    out.push({
      code,
      nameAr: str(m.name_ar) ?? code,
      nameEn: str(m.name_en) ?? code,
      currency,
      timezone: str(m.timezone) ?? "",
      dialCode: str(m.dial_code) ?? "",
      signupOpen: m.signup_open === true,
      listed: m.listed === true,
      missing: (Array.isArray(m.missing) ? m.missing : []).filter((x): x is MarketMissing => MISSING.has(x as MarketMissing)),
      clinics: num(m.clinics),
      prices,
      offer,
      taxRegistration,
    });
  }
  return out;
}

/** A price typed into the form: a positive number, or null for "not for
 *  sale" when the box is empty. undefined when it is not a valid entry. */
export function parsePriceInput(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
