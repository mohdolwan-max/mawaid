// The clinic owner's report (0054). Free of React and the database so the
// arithmetic can be tested directly.
//
// Every rate here returns null rather than 0 when there is nothing to
// divide by: a clinic with no finished visits has no no-show rate, and
// printing 0% would read as "nobody misses appointments here"
// (ENGINEERING-STANDARDS section 1).

import { num } from "@/lib/admin";
import { BOOKING_SOURCES, isBookingSource, type BookingSource } from "@/lib/qr";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const n0 = (v: unknown): number => num(v) ?? 0;

export type ReportTotals = {
  total: number;
  booked: number;
  completed: number;
  cancelled: number;
  noShow: number;
};

export type ServiceRow = {
  serviceId: string;
  name: string;
  total: number;
  completed: number;
  noShow: number;
  value: number;
};

export type StaffRow = {
  /** null for a booking taken without choosing a staff member. */
  staffId: string | null;
  total: number;
  completed: number;
  noShow: number;
  value: number;
};

export type ReportDay = {
  day: string;
  total: number;
  completed: number;
  noShow: number;
  value: number;
};

export type OrgReport = {
  generatedAt: string;
  timezone: string;
  from: string;
  to: string;
  totals: ReportTotals;
  /** The period just before, of the same length. */
  previous: { total: number; completed: number; noShow: number };
  money: {
    /** Worth of completed visits: the service price, or the visit's share
     *  of a package when drawn from one (0064). */
    completedValue: number;
    /** Completed visits whose service has a price, and those without one. */
    priced: number;
    unpriced: number;
    previousValue: number;
    /** Completed visits drawn from a package (0064; 0 before it). */
    fromPackages: number;
  };
  byService: ServiceRow[];
  byStaff: StaffRow[];
  customers: { people: number; new: number };
  series: ReportDay[];
  /** Bookings from the clinic's QR code (0060) and its links (0065), same
   *  rows as totals. null before 0060 is applied — the section hides
   *  rather than saying 0. Before 0065 only the QR count exists, and
   *  bySource holds just that. */
  sources: {
    qr: number;
    qrPrevious: number;
    bySource: Partial<Record<BookingSource, number>>;
    bySourcePrevious: Partial<Record<BookingSource, number>>;
  } | null;
  /** Package money on the day it moved (0064): a different measure from
   *  the value of completed visits, never added to it. null before 0064. */
  packages: {
    catalogue: number;
    sold: number;
    soldValue: number;
    refunded: number;
    previousSoldValue: number;
  } | null;
};

export function parseOrgReport(raw: unknown): OrgReport | null {
  if (!isObj(raw) || typeof raw.generated_at !== "string") return null;
  const t = isObj(raw.totals) ? raw.totals : {};
  const p = isObj(raw.previous) ? raw.previous : {};
  const m = isObj(raw.money) ? raw.money : {};
  const c = isObj(raw.customers) ? raw.customers : {};

  const byService: ServiceRow[] = [];
  for (const row of Array.isArray(raw.by_service) ? raw.by_service : []) {
    if (!isObj(row) || typeof row.service_id !== "string") continue;
    byService.push({
      serviceId: row.service_id,
      name: typeof row.name === "string" ? row.name : "",
      total: n0(row.total),
      completed: n0(row.completed),
      noShow: n0(row.no_show),
      value: n0(row.value),
    });
  }

  const byStaff: StaffRow[] = [];
  for (const row of Array.isArray(raw.by_staff) ? raw.by_staff : []) {
    if (!isObj(row)) continue;
    byStaff.push({
      staffId: typeof row.staff_id === "string" ? row.staff_id : null,
      total: n0(row.total),
      completed: n0(row.completed),
      noShow: n0(row.no_show),
      value: n0(row.value),
    });
  }

  const series: ReportDay[] = [];
  for (const row of Array.isArray(raw.series) ? raw.series : []) {
    if (!isObj(row) || typeof row.day !== "string") continue;
    series.push({
      day: row.day.slice(0, 10),
      total: n0(row.total),
      completed: n0(row.completed),
      noShow: n0(row.no_show),
      value: n0(row.value),
    });
  }

  return {
    generatedAt: raw.generated_at,
    timezone: typeof raw.timezone === "string" ? raw.timezone : "Asia/Amman",
    from: typeof raw.from === "string" ? raw.from.slice(0, 10) : "",
    to: typeof raw.to === "string" ? raw.to.slice(0, 10) : "",
    totals: {
      total: n0(t.total),
      booked: n0(t.booked),
      completed: n0(t.completed),
      cancelled: n0(t.cancelled),
      noShow: n0(t.no_show),
    },
    previous: { total: n0(p.total), completed: n0(p.completed), noShow: n0(p.no_show) },
    money: {
      completedValue: n0(m.completed_value),
      priced: n0(m.priced),
      unpriced: n0(m.unpriced),
      previousValue: n0(m.previous_value),
      fromPackages: n0(m.from_packages),
    },
    byService,
    byStaff,
    customers: { people: n0(c.people), new: n0(c.new) },
    series,
    sources: isObj(raw.sources) ? parseSources(raw.sources) : null,
    packages: isObj(raw.packages)
      ? {
          catalogue: n0(raw.packages.catalogue),
          sold: n0(raw.packages.sold),
          soldValue: n0(raw.packages.sold_value),
          refunded: n0(raw.packages.refunded),
          previousSoldValue: n0(raw.packages.previous_sold_value),
        }
      : null,
  };
}

function sourceCounts(raw: unknown): Partial<Record<BookingSource, number>> {
  const out: Partial<Record<BookingSource, number>> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (isBookingSource(k)) out[k] = n0(v);
  return out;
}

function parseSources(s: Obj): NonNullable<OrgReport["sources"]> {
  const qr = n0(s.qr);
  const qrPrevious = n0(s.qr_previous);
  // Before 0065 there is no breakdown: the QR count is the whole of it.
  const has = isObj(s.by_source);
  return {
    qr,
    qrPrevious,
    bySource: has ? sourceCounts(s.by_source) : qr > 0 ? { qr } : {},
    bySourcePrevious: has ? sourceCounts(s.by_source_previous) : qrPrevious > 0 ? { qr: qrPrevious } : {},
  };
}

/** The QR code's share of the period's bookings, as a whole percent. null
 *  when it cannot be said: no source data, or no bookings at all. */
export function qrShare(r: Pick<OrgReport, "totals" | "sources">): number | null {
  if (!r.sources || r.totals.total <= 0) return null;
  return Math.round((r.sources.qr / r.totals.total) * 100);
}

export type SourceRow = { source: BookingSource; count: number; previous: number; share: number | null };

/** One row per source that brought a booking in either period, in the
 *  fixed order of BOOKING_SOURCES, with its share of the period's
 *  bookings (null when the period has none). */
export function sourceRows(r: Pick<OrgReport, "totals" | "sources">): SourceRow[] {
  if (!r.sources) return [];
  const rows: SourceRow[] = [];
  for (const source of BOOKING_SOURCES) {
    const count = r.sources.bySource[source] ?? 0;
    const previous = r.sources.bySourcePrevious[source] ?? 0;
    if (count === 0 && previous === 0) continue;
    rows.push({ source, count, previous, share: r.totals.total > 0 ? Math.round((count / r.totals.total) * 100) : null });
  }
  return rows;
}

/** All bookings that came through a code or a link, this period and the
 *  one before. */
export function trackedBookings(r: Pick<OrgReport, "sources">): { count: number; previous: number } | null {
  if (!r.sources) return null;
  const sum = (o: Partial<Record<BookingSource, number>>) => Object.values(o).reduce((a, b) => a + (b ?? 0), 0);
  return { count: sum(r.sources.bySource), previous: sum(r.sources.bySourcePrevious) };
}

/** Share of finished visits that the customer did not attend, as a whole
 *  percent. Cancelled visits are not in the denominator: a cancellation is
 *  a message, a no-show is an empty chair. null when nothing finished. */
export function noShowRate(r: Pick<OrgReport, "totals">): number | null {
  const finished = r.totals.completed + r.totals.noShow;
  if (finished === 0) return null;
  return Math.round((r.totals.noShow / finished) * 100);
}

export function previousNoShowRate(r: Pick<OrgReport, "previous">): number | null {
  const finished = r.previous.completed + r.previous.noShow;
  if (finished === 0) return null;
  return Math.round((r.previous.noShow / finished) * 100);
}

/** Average price of a completed visit, counting only the visits that have
 *  a price. null when none of them does. */
export function averageVisitValue(r: Pick<OrgReport, "money">): number | null {
  if (r.money.priced === 0) return null;
  return r.money.completedValue / r.money.priced;
}

/** Busiest weekday in the period, 0 = Sunday, by number of visits. null
 *  when the period holds no visits at all. */
export function busiestWeekday(series: readonly ReportDay[]): { weekday: number; total: number } | null {
  const byWeekday = new Map<number, number>();
  for (const d of series) {
    const weekday = new Date(`${d.day}T00:00:00Z`).getUTCDay();
    byWeekday.set(weekday, (byWeekday.get(weekday) ?? 0) + d.total);
  }
  let best: { weekday: number; total: number } | null = null;
  for (const [weekday, total] of byWeekday) {
    if (total > 0 && (best === null || total > best.total)) best = { weekday, total };
  }
  return best;
}

/** The services worth naming, most-booked first, capped. */
export function topServices(rows: readonly ServiceRow[], limit = 5): ServiceRow[] {
  return [...rows].sort((a, b) => b.total - a.total || b.value - a.value).slice(0, limit);
}
