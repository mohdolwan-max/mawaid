// Directory reference data — client-importable (no "server-only"): these
// keys/labels are rendered in client components (chips, selects) as well
// as server components. Keys are what's stored in organizations.category
// and organizations.city; labels come from here, not the i18n dictionary,
// because they're data rather than UI copy.

import type { Lang } from "@/lib/i18n";

export type CategoryKey =
  | "dental"
  | "derma"
  | "laser"
  | "salon_women"
  | "barber"
  | "spa"
  | "optics"
  | "kids"
  | "physio"
  | "general";

export const CATEGORIES: {
  key: CategoryKey;
  ar: string;
  en: string;
  color: string;
  icon?: string;
}[] = [
  { key: "dental", ar: "أسنان", en: "Dental", color: "#e6f4ff", icon: "/icons/dental.webp" },
  { key: "derma", ar: "جلدية", en: "Dermatology", color: "#fdeef2", icon: "/icons/derma.webp" },
  { key: "laser", ar: "ليزر وتجميل", en: "Laser & Aesthetics", color: "#f2ecfb", icon: "/icons/laser.webp" },
  { key: "salon_women", ar: "صالون نسائي", en: "Ladies Salon", color: "#fdf0e6", icon: "/icons/beauty.webp" },
  { key: "barber", ar: "حلاقة رجالية", en: "Barbershop", color: "#eaf1fb", icon: "/icons/barber.webp" },
  { key: "spa", ar: "سبا ومساج", en: "Spa & Massage", color: "#e9f7f2", icon: "/icons/spa.webp" },
  { key: "optics", ar: "بصريات", en: "Optics", color: "#fef6e0", icon: "/icons/opti.webp" },
  { key: "kids", ar: "أطفال", en: "Pediatrics", color: "#fef0f0", icon: "/icons/baby.webp" },
  { key: "physio", ar: "علاج طبيعي", en: "Physiotherapy", color: "#eef7e9", icon: "/icons/physio.webp" },
  { key: "general", ar: "عام", en: "General", color: "#f0f2f5" },
];

export type CityKey =
  | "amman"
  | "zarqa"
  | "irbid"
  | "russeifa"
  | "aqaba"
  | "salt"
  | "mafraq"
  | "karak"
  | "madaba"
  | "jerash";

export const CITIES: { key: CityKey; ar: string; en: string }[] = [
  { key: "amman", ar: "عمّان", en: "Amman" },
  { key: "zarqa", ar: "الزرقاء", en: "Zarqa" },
  { key: "irbid", ar: "إربد", en: "Irbid" },
  { key: "russeifa", ar: "الرصيفة", en: "Russeifa" },
  { key: "aqaba", ar: "العقبة", en: "Aqaba" },
  { key: "salt", ar: "السلط", en: "Salt" },
  { key: "mafraq", ar: "المفرق", en: "Mafraq" },
  { key: "karak", ar: "الكرك", en: "Karak" },
  { key: "madaba", ar: "مادبا", en: "Madaba" },
  { key: "jerash", ar: "جرش", en: "Jerash" },
];

// Categories promoted on the home page's rows + given a tiebreaker boost
// in search ordering — a pure display/business decision (V2 blueprint
// "Beauty & Wellness first"), NOT a filter: every category stays fully
// browsable via /search and bookable directly. Reversible by editing this
// one constant, no migration needed.
export const FEATURED_CATEGORIES: CategoryKey[] = [
  "dental",
  "derma",
  "laser",
  "salon_women",
  "barber",
  "spa",
];

export function categoryLabel(key: string | null, lang: Lang): string {
  const cat = CATEGORIES.find((c) => c.key === key);
  return cat ? cat[lang] : "";
}

export function cityLabel(key: string | null, lang: Lang): string {
  const city = CITIES.find((c) => c.key === key);
  return city ? city[lang] : "";
}

// Was "$".repeat(tier), which printed dollar signs at a Jordanian
// audience paying in dinars — and reads as a currency claim rather than
// a price band. Words say the same thing without naming a currency at
// all, so this stays correct when the app reaches Egypt.
export const PRICE_TIERS: Record<number, { ar: string; en: string }> = {
  1: { ar: "اقتصادي", en: "Budget" },
  2: { ar: "متوسط", en: "Mid-range" },
  3: { ar: "مرتفع", en: "Premium" },
};

export function priceTierLabel(tier: number | null, lang: Lang): string {
  if (!tier) return "";
  return PRICE_TIERS[Math.min(Math.max(tier, 1), 3)]?.[lang] ?? "";
}

/** "1 review", not "1 reviews" (re-test report, 2026-09-03) — and the
 *  Arabic side needs the same care: تقييم / تقييمان / تقييمات / تقييماً
 *  by the same 1 / 2 / 3-10 / 11+ rule as [[facilityCountLabel]]. A
 *  plain "{n} reviews" template cannot express either language. */
export function reviewCountLabel(n: number, lang: "ar" | "en"): string {
  if (lang === "en") return n === 1 ? "1 review" : `${n} reviews`;
  if (n === 1) return "تقييم واحد";
  if (n === 2) return "تقييمان";
  if (n >= 3 && n <= 10) return `${n} تقييمات`;
  return `${n} تقييماً`;
}

/** "3 منشآت" with real Arabic number agreement (1 / 2 / 3-10 / 11+) —
 *  the zone tiles and the open-now line both count mixed businesses
 *  (clinics AND salons), hence منشأة rather than عيادة. */
export function facilityCountLabel(n: number, lang: "ar" | "en"): string {
  if (lang === "en") return n === 1 ? "1 place" : `${n} places`;
  if (n === 1) return "منشأة واحدة";
  if (n === 2) return "منشأتان";
  if (n >= 3 && n <= 10) return `${n} منشآت`;
  return `${n} منشأة`;
}

export type DirectoryOrg = {
  org_id: string;
  name: string;
  slug: string;
  city: string | null;
  district: string | null;
  category: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  price_tier: number | null;
  avg_rating: number | null;
  review_count: number;
  /** Present only on rows from list_nearby_orgs. Never defaulted to 0 —
   *  a card without a known distance shows nothing, not "0 كم". */
  distance_km?: number | null;
  /** Cheapest active priced service ("from 25 JOD"). Optional because
   *  list_nearby_orgs and pre-0036 databases don't return it; absent or
   *  null renders NO price line — never 0, which would read as free. */
  min_price?: number | null;
};

// Client-writable cookie carrying the customer's ROUNDED position
// ("31.944,35.882"). Named here rather than in lib/location.ts because
// that file is server-only and the client component that writes the
// cookie needs the same constant.
export const GEO_COOKIE = "mawaid_geo";

// "850 م" under a kilometre, "1.2 كم" above it. Metres are rounded to
// 50 because the customer's own position is rounded to ~110m before it
// ever leaves their device — showing 837م would claim a precision the
// input does not have.
export function distanceLabel(km: number | null | undefined, lang: Lang): string {
  if (km == null || !Number.isFinite(km) || km < 0) return "";
  const locale = lang === "ar" ? "ar-JO" : "en-US";
  if (km < 1) {
    const m = Math.max(50, Math.round((km * 1000) / 50) * 50);
    return `${m.toLocaleString(locale)} ${lang === "ar" ? "م" : "m"}`;
  }
  const n = km.toLocaleString(locale, { maximumFractionDigits: 1 });
  return `${n} ${lang === "ar" ? "كم" : "km"}`;
}

// Pulls coordinates out of a full Google Maps link. The pin marker
// (!3d…!4d…) is preferred over the @…, viewport centre — the viewport is
// wherever the map happened to be panned, the pin is the place itself.
// Short links (maps.app.goo.gl) carry no coordinates and return null;
// the settings UI says so instead of failing silently.
export function parseMapsLink(url: string): { lat: number; lng: number } | null {
  const pin = url.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  const viewport = url.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  const query = url.match(/[?&](?:q|query|ll|destination)=(-?\d{1,3}\.\d+)(?:%2C|,)(-?\d{1,3}\.\d+)/i);
  const m = pin ?? viewport ?? query;
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
