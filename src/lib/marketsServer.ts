import "server-only";
import { unstable_cache } from "next/cache";
import { publicSupabase } from "@/lib/supabase/public";
import type { Market } from "@/lib/markets";

export const MARKETS_TAG = "markets";

type MarketRow = {
  code: string;
  name_ar: string;
  name_en: string;
  currency: string;
  dial_code: string;
  signup_open: boolean;
  listed: boolean;
  sort: number;
};

// Jordan as it was before countries existed. Used only when list_markets
// fails, so the marketplace keeps working in the one country it had,
// instead of every public page erroring; the failure is logged.
const JORDAN_ONLY: Market[] = [
  { code: "JO", nameAr: "الأردن", nameEn: "Jordan", currency: "JOD", dialCode: "962", signupOpen: true, listed: true, sort: 1 },
];

// Read by every public page (the city picker, the visitor's default city),
// the same for everybody, and changed only from the admin countries page,
// which drops this tag. Five minutes bounds how stale it can be otherwise.
const cachedMarkets = unstable_cache(
  async (): Promise<Market[]> => {
    const { data, error } = await publicSupabase.rpc("list_markets");
    if (error || !data) {
      console.error("list_markets failed", error);
      // Thrown so a failure is not cached for five minutes.
      throw error ?? new Error("list_markets returned nothing");
    }
    return (data as MarketRow[]).map((r) => ({
      code: r.code,
      nameAr: r.name_ar,
      nameEn: r.name_en,
      currency: r.currency,
      dialCode: r.dial_code,
      signupOpen: r.signup_open,
      listed: r.listed,
      sort: r.sort,
    }));
  },
  ["list-markets"],
  { revalidate: 300, tags: [MARKETS_TAG] }
);

export async function getMarkets(): Promise<Market[]> {
  try {
    return await cachedMarkets();
  } catch {
    return JORDAN_ONLY;
  }
}
