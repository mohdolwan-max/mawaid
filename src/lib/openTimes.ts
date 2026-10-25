// Search by free time (0069): the day and time-of-day choices, and the
// rows. Free of React and the database so it can be tested directly
// (ENGINEERING-STANDARDS §4).

import { addDaysYMD } from "@/lib/date";

/** The calendar day at that instant in that timezone. */
const ymdIn = (timezone: string, now: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** The visitor's country decides what "today" means. */
const COUNTRY_TZ: Record<string, string> = { JO: "Asia/Amman", SA: "Asia/Riyadh" };
export const countryTimezone = (country: string | null | undefined) => COUNTRY_TZ[country ?? ""] ?? "Asia/Amman";

/** Today and the six days after it, as offered in the search form. */
export const DAY_OFFSETS = [0, 1, 2, 3, 4, 5, 6] as const;

/** Parts of the day, on the clinic's clock; `to` is exclusive. */
export const WINDOWS = {
  morning: { from: "06:00", to: "12:00" },
  afternoon: { from: "12:00", to: "17:00" },
  evening: { from: "17:00", to: "24:00" },
} as const;
export type WindowKey = keyof typeof WINDOWS;

/** ?day= and ?time= as the search page receives them. null day = the
 *  ordinary directory search; anything unknown is ignored, never an
 *  error (the query string is anyone's to edit). */
export function parseWhen(
  params: { day?: string; time?: string },
  timezone: string,
  now: Date = new Date()
): { offset: number; date: string; window: WindowKey | null } | null {
  const offset = Number(params.day);
  if (params.day === undefined || params.day === "" || !Number.isInteger(offset) || !DAY_OFFSETS.includes(offset as never)) return null;
  const date = addDaysYMD(ymdIn(timezone, now), offset);
  // Own keys only: `in` would also accept "toString" and the like.
  const window = params.time && Object.hasOwn(WINDOWS, params.time) ? (params.time as WindowKey) : null;
  return { offset, date, window };
}

/** The booking page on that day with the service chosen and the time
 *  picked in the search already selected (it is checked again there). */
export function openTimeHref(slug: string, serviceId: string, day: string, iso: string): string {
  return `/${encodeURIComponent(slug)}/book?services=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(day)}&at=${encodeURIComponent(iso)}`;
}

/** ?at= for the booking page: an instant on the chosen day (in the
 *  clinic's timezone), else null. Whether it is still free is the slot
 *  list's business, not this one's. */
export function parseBookAt(raw: string | string[] | undefined, day: string | null, timezone: string): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !day || v.length > 40) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return ymdIn(timezone, d) === day ? d.toISOString() : null;
}

export type OpenTimesRow = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  city: string | null;
  district: string | null;
  logoUrl: string | null;
  avgRating: number | null;
  reviewCount: number;
  currency: string;
  serviceId: string;
  serviceName: string;
  /** null = the clinic set no price; never shown as 0. */
  price: number | null;
  durationMinutes: number | null;
  times: string[];
};

export function parseOpenTimes(raw: unknown): OpenTimesRow[] {
  const out: OpenTimesRow[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r) || typeof r.org_slug !== "string" || typeof r.service_id !== "string") continue;
    const times = Array.isArray(r.times) ? r.times.filter((t): t is string => typeof t === "string") : [];
    if (times.length === 0) continue;
    out.push({
      orgId: str(r.org_id) ?? "",
      orgName: str(r.org_name) ?? "",
      orgSlug: r.org_slug,
      city: str(r.city),
      district: str(r.district),
      logoUrl: str(r.logo_url),
      avgRating: numOrNull(r.avg_rating),
      reviewCount: numOrNull(r.review_count) ?? 0,
      currency: str(r.currency) ?? "JOD",
      serviceId: r.service_id,
      serviceName: str(r.service_name) ?? "",
      price: numOrNull(r.price),
      durationMinutes: numOrNull(r.duration_minutes),
      times,
    });
  }
  return out;
}
