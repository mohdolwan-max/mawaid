// Session packages (0064): shapes, parsing and the rules the pages share.
// Free of React and the database so it can be tested directly
// (ENGINEERING-STANDARDS §4). The database decides; these mirror its
// limits so a form can say what is wrong before the round trip.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown): number => numOrNull(v) ?? 0;

export const PACKAGE_NAME_MAX = 80;
export const PACKAGE_SESSIONS_MIN = 2;
export const PACKAGE_SESSIONS_MAX = 100;
export const PACKAGE_VALIDITY_MAX = 1095;
export const PACKAGE_PRICE_MAX = 1_000_000;
export const PACKAGE_NOTE_MAX = 500;

/** A package the clinic offers (list_service_packages). */
export type CataloguePackage = {
  id: string;
  serviceId: string;
  service: string;
  name: string;
  sessions: number;
  price: number;
  /** null = never expires. */
  validityDays: number | null;
  active: boolean;
  /** How many times it was sold; a sold package is retired, not deleted. */
  sold: number;
};

export function parseCatalogue(raw: unknown): CataloguePackage[] {
  const out: CataloguePackage[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r) || typeof r.id !== "string" || typeof r.service_id !== "string") continue;
    out.push({
      id: r.id,
      serviceId: r.service_id,
      service: str(r.service) ?? "",
      name: str(r.name) ?? "",
      sessions: num(r.sessions),
      price: num(r.price),
      validityDays: numOrNull(r.validity_days),
      active: r.active !== false,
      sold: num(r.sold),
    });
  }
  return out;
}

export type PackageStatus = "active" | "used_up" | "expired" | "cancelled";
const STATUSES = new Set<PackageStatus>(["active", "used_up", "expired", "cancelled"]);

/** A package one customer bought (get_org_customer.packages). */
export type CustomerPackage = {
  id: string;
  name: string;
  serviceId: string;
  service: string;
  sessionsTotal: number;
  used: number;
  remaining: number;
  pricePaid: number;
  soldAt: string;
  /** The first instant it is no longer valid; null = never expires. */
  expiresAt: string | null;
  soldBy: string;
  note: string | null;
  cancelledAt: string | null;
  refundAmount: number | null;
  status: PackageStatus;
  canCancel: boolean;
};

export function parseCustomerPackages(raw: unknown): CustomerPackage[] {
  const out: CustomerPackage[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r) || typeof r.id !== "string" || typeof r.service_id !== "string") continue;
    const status = String(r.status) as PackageStatus;
    if (!STATUSES.has(status)) continue;
    out.push({
      id: r.id,
      name: str(r.name) ?? "",
      serviceId: r.service_id,
      service: str(r.service) ?? "",
      sessionsTotal: num(r.sessions_total),
      used: num(r.used),
      remaining: num(r.remaining),
      pricePaid: num(r.price_paid),
      soldAt: str(r.sold_at) ?? "",
      expiresAt: str(r.expires_at),
      soldBy: str(r.sold_by) ?? "",
      note: str(r.note),
      cancelledAt: str(r.cancelled_at),
      refundAmount: numOrNull(r.refund_amount),
      status,
      canCancel: r.can_cancel === true,
    });
  }
  return out;
}

/** The catalogue as the customer file carries it (active entries only). */
export function parseSellable(raw: unknown): CataloguePackage[] {
  return parseCatalogue(Array.isArray(raw) ? raw.map((r) => (isObj(r) ? { ...r, active: true, sold: 0 } : r)) : []);
}

/** What one session of a package is worth: the price paid shared evenly.
 *  The database values a visit drawn from a package the same way
 *  (_visit_values), so the file, the list and the report agree. */
export function perSessionValue(pricePaid: number, sessions: number): number | null {
  return sessions > 0 && Number.isFinite(pricePaid) ? pricePaid / sessions : null;
}

/** The last day a package can be used, as an instant inside that day.
 *  expires_at is the midnight AFTER the last day, so printing it as a date
 *  would promise one day too many. */
export function lastValidInstant(expiresAt: string | null): Date | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) ? new Date(t - 1) : null;
}

/** The packages a finished visit may be drawn from: same service, usable,
 *  and still valid on the visit's date. The current one is always offered
 *  so the choice on screen can show it. */
export function packagesForVisit(
  visit: { serviceId: string | null; startAt: string; packageId: string | null },
  packages: readonly CustomerPackage[]
): CustomerPackage[] {
  const at = new Date(visit.startAt).getTime();
  return packages.filter(
    (p) =>
      p.id === visit.packageId ||
      (visit.serviceId !== null &&
        p.serviceId === visit.serviceId &&
        p.status !== "cancelled" &&
        p.remaining > 0 &&
        (p.expiresAt === null || at < new Date(p.expiresAt).getTime()))
  );
}

export type PackageInputError =
  | "package_err_name"
  | "package_err_sessions"
  | "package_err_price"
  | "package_err_validity"
  | "package_err_service";

/** The catalogue form as typed. Validity left empty means it never
 *  expires; a price left empty is an error, not 0 (a free package is
 *  typed as 0 on purpose). */
export function parsePackageInput(input: {
  serviceId: string;
  name: string;
  sessions: string;
  price: string;
  validityDays: string;
}):
  | { ok: true; serviceId: string; name: string; sessions: number; price: number; validityDays: number | null }
  | { ok: false; error: PackageInputError } {
  const name = input.name.trim();
  if (!input.serviceId) return { ok: false, error: "package_err_service" };
  if (name.length < 1 || name.length > PACKAGE_NAME_MAX) return { ok: false, error: "package_err_name" };
  const sessions = Number(input.sessions);
  if (!Number.isInteger(sessions) || sessions < PACKAGE_SESSIONS_MIN || sessions > PACKAGE_SESSIONS_MAX)
    return { ok: false, error: "package_err_sessions" };
  const price = input.price.trim() === "" ? NaN : Number(input.price);
  if (!Number.isFinite(price) || price < 0 || price > PACKAGE_PRICE_MAX) return { ok: false, error: "package_err_price" };
  let validityDays: number | null = null;
  if (input.validityDays.trim() !== "") {
    validityDays = Number(input.validityDays);
    if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > PACKAGE_VALIDITY_MAX)
      return { ok: false, error: "package_err_validity" };
  }
  return { ok: true, serviceId: input.serviceId, name, sessions, price, validityDays };
}

/** A price typed at the desk (sale or refund): a finite amount between 0
 *  and the ceiling. null = not a valid amount. */
export function parseAmount(input: string, max = PACKAGE_PRICE_MAX): number | null {
  const s = input.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

/** Usable packages by customer and service, for the bookings list and the
 *  calendar: key = normalised phone + service. name and perSession are the
 *  package the next completed visit will draw on (the database lists them
 *  in that order); remaining is the total across all of them. */
export type Holder = { name: string; remaining: number; perSession: number | null };
export type HolderMap = Map<string, Holder>;

export const holderKey = (phone: string, serviceId: string) => `${phone}|${serviceId}`;

export function parseHolders(raw: unknown): HolderMap {
  const map: HolderMap = new Map();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r) || typeof r.phone !== "string" || typeof r.service_id !== "string") continue;
    const key = holderKey(r.phone, r.service_id);
    const prev = map.get(key);
    const remaining = num(r.remaining);
    // Several usable packages for one service: the desk needs the total.
    map.set(
      key,
      prev
        ? { ...prev, remaining: prev.remaining + remaining }
        : { name: str(r.name) ?? "", remaining, perSession: numOrNull(r.per_session) }
    );
  }
  return map;
}

/** What a visit drew on, as visit_package_state returns it. */
export type VisitPackageState = { name: string; remaining: number; sessionsTotal: number };

export function parseVisitPackageState(raw: unknown): VisitPackageState | null {
  if (!isObj(raw) || typeof raw.name !== "string") return null;
  return { name: raw.name, remaining: num(raw.remaining), sessionsTotal: num(raw.sessions_total) };
}

/** A visit's worth as the calendar shows it, by the report's rule: a
 *  finished visit is what the database recorded (its package share or
 *  its price); a booked one held by a package will be worth that
 *  package's share once completed; anything else is the service price.
 *  null = unpriced, never 0. */
export function calendarVisitValue(input: {
  status: "booked" | "completed" | "cancelled" | "no_show";
  servicePrice: number | null;
  recorded: { value: number | null } | undefined;
  holder: Holder | undefined;
}): number | null {
  if (input.status !== "booked" && input.recorded) return input.recorded.value;
  if (input.status === "booked" && input.holder && input.holder.perSession !== null) return input.holder.perSession;
  return input.servicePrice;
}
