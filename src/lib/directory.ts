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

export const CATEGORIES: { key: CategoryKey; ar: string; en: string; emoji: string; color: string }[] = [
  { key: "dental", ar: "أسنان", en: "Dental", emoji: "🦷", color: "#e6f4ff" },
  { key: "derma", ar: "جلدية", en: "Dermatology", emoji: "🧴", color: "#fdeef2" },
  { key: "laser", ar: "ليزر وتجميل", en: "Laser & Aesthetics", emoji: "✨", color: "#f2ecfb" },
  { key: "salon_women", ar: "صالون نسائي", en: "Ladies Salon", emoji: "💇‍♀️", color: "#fdf0e6" },
  { key: "barber", ar: "حلاقة رجالية", en: "Barbershop", emoji: "💈", color: "#eaf1fb" },
  { key: "spa", ar: "سبا ومساج", en: "Spa & Massage", emoji: "💆", color: "#e9f7f2" },
  { key: "optics", ar: "بصريات", en: "Optics", emoji: "👓", color: "#fef6e0" },
  { key: "kids", ar: "أطفال", en: "Pediatrics", emoji: "🧸", color: "#fef0f0" },
  { key: "physio", ar: "علاج طبيعي", en: "Physiotherapy", emoji: "🦵", color: "#eef7e9" },
  { key: "general", ar: "عام", en: "General", emoji: "🏥", color: "#f0f2f5" },
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
