// Runs on the server (any timezone, e.g. UTC on Vercel), so a plain
// `new Date()` + `.toISOString()` mix silently shifts dates by a day
// whenever the server's own clock isn't the org's local timezone. Unlike
// Mahsoob (single hardcoded STORE_TZ), this app is multi-tenant from day
// one — every org has its own timezone (org_settings.timezone) — so every
// helper here takes `tz` as a parameter instead of using a module constant.

export function nowIso(): string {
  return new Date().toISOString();
}

export function currentYear(): number {
  return new Date().getUTCFullYear();
}

export function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export function todayYMD(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function dateFromYMD(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function ymdFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDaysYMD(ymd: string, days: number): string {
  const d = dateFromYMD(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return ymdFromDate(d);
}

// Weekday index (0=Sunday..6=Saturday) for a YMD date, computed in the
// org's own timezone rather than the server's local/UTC weekday, which can
// differ near midnight.
export function weekdayIndex(ymd: string, tz: string): number {
  const d = dateFromYMD(ymd);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? d.getUTCDay();
}

export function formatTime(ymd: string, hhmm: string, tz: string, lang: "ar" | "en"): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = dateFromYMD(ymd);
  d.setUTCHours(h, m, 0, 0);
  return new Intl.DateTimeFormat(intlLocale(lang), {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

// Arabic month names are not universal. Jordan and the rest of the Levant
// say أيلول where Saudi Arabia and Egypt say سبتمبر — and every call site
// here asked for "ar-SA", i.e. Saudi forms inside a product that targets
// Jordan. Verified in a real browser that all three of ar-SA/ar-JO/ar-EG
// resolve to the gregorian calendar, so this changes the spelling of the
// month and nothing about the numbers.
//
// Kept as a single constant because the market is expanding: Egypt is
// "ar-EG", which makes that a one-line change here instead of thirteen
// edits scattered across the app. When a second country actually ships,
// this becomes a lookup on the org's country rather than a constant.
export const AR_LOCALE = "ar-JO";

export function intlLocale(lang: "ar" | "en"): string {
  return lang === "ar" ? AR_LOCALE : "en-US";
}

// Where an instant falls in the CLINIC's day, as minutes past its local
// midnight. The calendar positions every booking with this: a clinic in
// Amman viewed from a phone still set to another timezone must show its
// 3pm appointment at 3pm, not shifted. Intl is the only way to do this
// without pulling in a timezone library — hour12:false so 12am reads as
// 00 rather than 12.
export function localMinutes(iso: string, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // "24" appears for midnight in some ICU versions; fold it back to 0.
  return (get("hour") % 24) * 60 + get("minute");
}

// The clinic's local calendar date for an instant. Used to bucket
// bookings into days — start_at.slice(0, 10) would bucket by UTC and put
// a 2am Amman appointment on the previous day.
export function localYMD(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// Sunday-first week containing `ymd`, as seven YMD strings. The business
// week here starts Sunday because business_hours is keyed 0=Sunday and
// Friday is the day clinics close.
export function weekYMDs(ymd: string, tz: string): string[] {
  const start = addDaysYMD(ymd, -weekdayIndex(ymd, tz));
  return Array.from({ length: 7 }, (_, i) => addDaysYMD(start, i));
}
