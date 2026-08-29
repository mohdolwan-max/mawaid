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

export function priceTierLabel(tier: number | null): string {
  if (!tier || tier < 1) return "";
  return "$".repeat(Math.min(tier, 3));
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
};
