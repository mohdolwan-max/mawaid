// Reporting periods for the admin pages (0050). Free of React and the
// database so it can be tested directly.
//
// Owner's request: choose the period the way Mahsoob does — a list of
// presets plus a custom range, carried in the URL as ?from=&to=&custom=1.
// Two things are deliberately different from Mahsoob:
//   * "today" comes from the server in the admin timezone and is passed in.
//     Mahsoob's picker takes today from the browser, so a browser outside
//     the store's timezone could match the wrong preset.
//   * This year and last year are presets too: a tax filing is yearly.
//
// Days are "YYYY-MM-DD" strings. Arithmetic uses UTC midnights only, so no
// timezone can shift a day.

export const PERIOD_PRESETS = [
  "today",
  "yesterday",
  "week",
  "last_week",
  "month",
  "last_month",
  "last30",
  "year",
  "last_year",
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

/** from and to are both included; at most this many days apart (0050's
 *  _admin_period_ok: p_to - p_from <= 366). */
export const MAX_PERIOD_SPAN = 366;

export type Period = {
  from: string;
  to: string;
  /** The preset these dates are, or null for a custom range. */
  preset: PeriodPreset | null;
  /** The custom date fields are open. */
  custom: boolean;
};

export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = toDate(v);
  return !Number.isNaN(d.getTime()) && fromDate(d) === v;
}

function toDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(ymd: string, days: number): string {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDate(d);
}

/** Days in the period, both ends included. */
export function periodDays(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1;
}

/** Weeks start on Sunday, as business_hours does ("0" = Sunday). */
export function presetRange(preset: PeriodPreset, today: string): [string, string] {
  const t = toDate(today);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const weekStart = addDays(today, -t.getUTCDay());
  switch (preset) {
    case "today":
      return [today, today];
    case "yesterday": {
      const d = addDays(today, -1);
      return [d, d];
    }
    case "week":
      return [weekStart, today];
    case "last_week":
      return [addDays(weekStart, -7), addDays(weekStart, -1)];
    case "month":
      return [fromDate(new Date(Date.UTC(y, m, 1))), today];
    case "last_month":
      return [fromDate(new Date(Date.UTC(y, m - 1, 1))), fromDate(new Date(Date.UTC(y, m, 0)))];
    case "last30":
      return [addDays(today, -29), today];
    case "year":
      return [`${y}-01-01`, today];
    case "last_year":
      return [`${y - 1}-01-01`, `${y - 1}-12-31`];
  }
}

export function matchPreset(from: string, to: string, today: string): PeriodPreset | null {
  for (const p of PERIOD_PRESETS) {
    const [f, t] = presetRange(p, today);
    if (f === from && t === to) return p;
  }
  return null;
}

/** A usable period from the URL. Anything missing, malformed, reversed or
 *  longer than the database accepts falls back to this month, so a bad
 *  link opens the page instead of an error. */
export function parsePeriod(
  params: { from?: string | string[]; to?: string | string[]; custom?: string | string[] },
  today: string
): Period {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const from = one(params.from);
  const to = one(params.to);
  const wantsCustom = one(params.custom) === "1";

  if (isYmd(from) && isYmd(to) && from <= to && periodDays(from, to) - 1 <= MAX_PERIOD_SPAN) {
    const preset = matchPreset(from, to, today);
    return { from, to, preset, custom: wantsCustom || preset === null };
  }
  const [f, t] = presetRange("month", today);
  return { from: f, to: t, preset: "month", custom: false };
}

/** The period just before, of the same length: what "vs previous" means. */
export function previousPeriod(from: string, to: string): [string, string] {
  const days = periodDays(from, to);
  return [addDays(from, -days), addDays(from, -1)];
}

/** Query string for a period, keeping any other parameters given. */
export function periodSearch(
  period: { from: string; to: string; custom: boolean },
  keep: Record<string, string | null | undefined> = {}
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
  q.set("from", period.from);
  q.set("to", period.to);
  if (period.custom) q.set("custom", "1");
  return q.toString();
}

export type Bucket = { start: string; end: string; value: number };
export type BucketSize = "day" | "week" | "month";

/** One bar per day up to two months, per week up to six months, per month
 *  beyond: 366 daily bars would be a pixel each. A week or month cut by
 *  the period keeps only the days inside it. */
export function bucketSize(from: string, to: string): BucketSize {
  const days = periodDays(from, to);
  if (days <= 62) return "day";
  if (days <= 183) return "week";
  return "month";
}

export function bucketSeries(points: readonly { day: string; value: number }[], from: string, to: string): Bucket[] {
  const size = bucketSize(from, to);
  const byDay = new Map<string, number>();
  for (const p of points) {
    if (Number.isFinite(p.value)) byDay.set(p.day, (byDay.get(p.day) ?? 0) + p.value);
  }
  const out: Bucket[] = [];
  let day = from;
  while (day <= to) {
    let end: string;
    if (size === "day") {
      end = day;
    } else if (size === "week") {
      end = addDays(day, 6 - toDate(day).getUTCDay());
    } else {
      const d = toDate(day);
      end = fromDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    }
    if (end > to) end = to;
    let value = 0;
    for (let d = day; d <= end; d = addDays(d, 1)) value += byDay.get(d) ?? 0;
    out.push({ start: day, end, value });
    day = addDays(end, 1);
  }
  return out;
}
