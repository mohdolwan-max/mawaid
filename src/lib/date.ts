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
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA" : "en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
