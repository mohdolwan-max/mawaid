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

export const CATEGORIES: { key: CategoryKey; ar: string; en: string; emoji: string }[] = [
  { key: "dental", ar: "أسنان", en: "Dental", emoji: "🦷" },
  { key: "derma", ar: "جلدية", en: "Dermatology", emoji: "🧴" },
  { key: "laser", ar: "ليزر وتجميل", en: "Laser & Aesthetics", emoji: "✨" },
  { key: "salon_women", ar: "صالون نسائي", en: "Ladies Salon", emoji: "💇‍♀️" },
  { key: "barber", ar: "حلاقة رجالية", en: "Barbershop", emoji: "💈" },
  { key: "spa", ar: "سبا ومساج", en: "Spa & Massage", emoji: "💆" },
  { key: "optics", ar: "بصريات", en: "Optics", emoji: "👓" },
  { key: "kids", ar: "أطفال", en: "Pediatrics", emoji: "🧸" },
  { key: "physio", ar: "علاج طبيعي", en: "Physiotherapy", emoji: "🦵" },
  { key: "general", ar: "عام", en: "General", emoji: "🏥" },
];

export type CityKey =
  | "riyadh"
  | "jeddah"
  | "makkah"
  | "madinah"
  | "dammam"
  | "khobar"
  | "taif"
  | "buraidah"
  | "abha"
  | "tabuk";

export const CITIES: { key: CityKey; ar: string; en: string }[] = [
  { key: "riyadh", ar: "الرياض", en: "Riyadh" },
  { key: "jeddah", ar: "جدة", en: "Jeddah" },
  { key: "makkah", ar: "مكة المكرمة", en: "Makkah" },
  { key: "madinah", ar: "المدينة المنورة", en: "Madinah" },
  { key: "dammam", ar: "الدمام", en: "Dammam" },
  { key: "khobar", ar: "الخبر", en: "Khobar" },
  { key: "taif", ar: "الطائف", en: "Taif" },
  { key: "buraidah", ar: "بريدة", en: "Buraidah" },
  { key: "abha", ar: "أبها", en: "Abha" },
  { key: "tabuk", ar: "تبوك", en: "Tabuk" },
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
