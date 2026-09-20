// The clinic owner's report (0054). Free of React and the database so the
// arithmetic can be tested directly.
//
// Every rate here returns null rather than 0 when there is nothing to
// divide by: a clinic with no finished visits has no no-show rate, and
// printing 0% would read as "nobody misses appointments here"
// (ENGINEERING-STANDARDS section 1).

import { num } from "@/lib/admin";

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
    /** Price of the services on completed visits. */
    completedValue: number;
    /** Completed visits whose service has a price, and those without one. */
    priced: number;
    unpriced: number;
    previousValue: number;
  };
  byService: ServiceRow[];
  byStaff: StaffRow[];
  customers: { people: number; new: number };
  series: ReportDay[];
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
    },
    byService,
    byStaff,
    customers: { people: n0(c.people), new: n0(c.new) },
    series,
  };
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
