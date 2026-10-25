// Recurring appointments (0067): the dates of a series and the time to
// propose on each. Free of React and the database so it can be tested
// directly (ENGINEERING-STANDARDS §4). The clinic sees every proposal
// before anything is booked (§2: propose, then apply).

import { addDaysYMD } from "@/lib/date";

export const SERIES_EVERY_WEEKS = [1, 2, 3, 4, 6, 8] as const;
export const SERIES_MIN = 2;
export const SERIES_MAX = 12;

/** The days of a series, the first one included, `everyWeeks` apart. */
export function seriesDays(firstYmd: string, everyWeeks: number, count: number): string[] {
  const n = Math.max(0, Math.min(SERIES_MAX, Math.floor(count)));
  const step = Math.max(1, Math.floor(everyWeeks)) * 7;
  return Array.from({ length: n }, (_, i) => addDaysYMD(firstYmd, i * step));
}

/** "15:30" for an instant, on the clinic's clock. */
export function localClock(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const m = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${h}:${m}`;
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** The time to propose on one day of the series: the same clock time when
 *  it is free; otherwise the free time nearest to it (the earlier one on a
 *  tie); null when the day has nothing free. */
export function pickSlot(
  slots: readonly string[],
  wanted: string,
  timezone: string
): { iso: string; exact: boolean } | null {
  if (slots.length === 0) return null;
  const target = minutes(wanted);
  let best: { iso: string; diff: number; at: number } | null = null;
  for (const iso of slots) {
    const at = minutes(localClock(iso, timezone));
    const diff = Math.abs(at - target);
    if (diff === 0) return { iso, exact: true };
    if (best === null || diff < best.diff || (diff === best.diff && at < best.at)) best = { iso, diff, at };
  }
  return best ? { iso: best.iso, exact: false } : null;
}

export type SeriesProposal = {
  day: string;
  /** null = nothing free that day. */
  startAt: string | null;
  exact: boolean;
  /** Whether it will be booked; the clinic can untick any. */
  include: boolean;
};

/** The whole proposal from each day's free times (same order as days).
 *  The first day is the time the clinic picked, always exact. */
export function proposeSeries(
  days: readonly string[],
  firstStartAt: string,
  slotsByDay: readonly (readonly string[])[],
  timezone: string
): SeriesProposal[] {
  const wanted = localClock(firstStartAt, timezone);
  return days.map((day, i) => {
    if (i === 0) return { day, startAt: firstStartAt, exact: true, include: true };
    const pick = pickSlot(slotsByDay[i] ?? [], wanted, timezone);
    return pick
      ? { day, startAt: pick.iso, exact: pick.exact, include: true }
      : { day, startAt: null, exact: false, include: false };
  });
}
