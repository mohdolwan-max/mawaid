// The customer file (0062): shapes, parsing and the small rules the pages
// share. Free of React and the database so it can be tested directly
// (ENGINEERING-STANDARDS §4).

import { toE164 } from "@/lib/phoneCode";
import { isBookingSource, type BookingSource } from "@/lib/qr";
import { parseCustomerPackages, parseSellable, type CataloguePackage, type CustomerPackage } from "@/lib/packages";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export const TAG_MAX = 8;
export const TAG_LEN = 30;

export type CustomerRow = {
  phone: string;
  name: string;
  email: string | null;
  completed: number;
  noShows: number;
  cancelled: number;
  upcoming: number;
  firstVisit: string | null;
  lastVisit: string | null;
  nextVisit: string | null;
  totalValue: number;
  tags: string[];
  notes: number;
  /** Usable session packages (0064); 0 before 0064 is applied. */
  packages: number;
};

/** list_org_customers rows; `total` is the count before paging. */
export function parseCustomerRows(raw: unknown): { rows: CustomerRow[]; total: number } {
  const rows: CustomerRow[] = [];
  let total = 0;
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!isObj(r) || typeof r.phone !== "string") continue;
    total = num(r.total_count);
    rows.push({
      phone: r.phone,
      name: str(r.name) ?? "—",
      email: str(r.email),
      completed: num(r.completed),
      noShows: num(r.no_shows),
      cancelled: num(r.cancelled),
      upcoming: num(r.upcoming),
      firstVisit: str(r.first_visit),
      lastVisit: str(r.last_visit),
      nextVisit: str(r.next_visit),
      totalValue: num(r.total_value),
      tags: strArr(r.tags),
      notes: num(r.notes),
      packages: num(r.packages),
    });
  }
  return { rows, total };
}

export type CustomerVisit = {
  id: string;
  startAt: string;
  status: "booked" | "completed" | "cancelled" | "no_show";
  notes: string | null;
  staffId: string | null;
  serviceId: string | null;
  service: string | null;
  /** What the visit is worth: its share of a package when drawn from one,
   *  else the service's price; null = unpriced (0064 _visit_values). */
  value: number | null;
  /** Where the booking came from (0060/0065); null = not from a known one. */
  source: BookingSource | null;
  /** The package this visit drew on, if any. */
  packageId: string | null;
  packageName: string | null;
  packageAuto: boolean;
  /** The clinic took this visit off any package. */
  packageOff: boolean;
};

export type CustomerNote = {
  id: string;
  body: string;
  createdAt: string;
  author: string;
  mine: boolean;
  canDelete: boolean;
};

export type CustomerFile = Omit<CustomerRow, "notes" | "packages"> & {
  unpriced: number;
  visits: CustomerVisit[];
  notes: CustomerNote[];
  packages: CustomerPackage[];
  /** Active catalogue entries to sell from. */
  catalogue: CataloguePackage[];
  isOwner: boolean;
};

const STATUSES = new Set(["booked", "completed", "cancelled", "no_show"]);

/** get_org_customer's jsonb; null = this clinic has no such customer. */
export function parseCustomerFile(raw: unknown): CustomerFile | null {
  if (!isObj(raw) || typeof raw.phone !== "string") return null;
  const visits: CustomerVisit[] = [];
  for (const v of Array.isArray(raw.visits) ? raw.visits : []) {
    if (!isObj(v) || typeof v.id !== "string" || typeof v.start_at !== "string" || !STATUSES.has(String(v.status))) continue;
    visits.push({
      id: v.id,
      startAt: v.start_at,
      status: v.status as CustomerVisit["status"],
      notes: str(v.notes),
      staffId: str(v.staff_id),
      serviceId: str(v.service_id),
      service: str(v.service),
      value: v.value === null || v.value === undefined ? null : num(v.value),
      source: isBookingSource(v.booking_source) ? v.booking_source : null,
      packageId: str(v.package_id),
      packageName: str(v.package_name),
      packageAuto: v.package_auto === true,
      packageOff: v.package_off === true,
    });
  }
  const notes: CustomerNote[] = [];
  for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
    if (!isObj(n) || typeof n.id !== "string" || typeof n.body !== "string") continue;
    notes.push({
      id: n.id,
      body: n.body,
      createdAt: str(n.created_at) ?? "",
      author: str(n.author) ?? "",
      mine: n.mine === true,
      canDelete: n.can_delete === true,
    });
  }
  return {
    phone: raw.phone,
    name: str(raw.name) ?? "—",
    email: str(raw.email),
    completed: num(raw.completed),
    noShows: num(raw.no_shows),
    cancelled: num(raw.cancelled),
    upcoming: num(raw.upcoming),
    firstVisit: str(raw.first_visit),
    lastVisit: str(raw.last_visit),
    nextVisit: str(raw.next_visit),
    totalValue: num(raw.total_value),
    unpriced: num(raw.unpriced),
    tags: strArr(raw.tags),
    visits,
    notes,
    packages: parseCustomerPackages(raw.packages),
    catalogue: parseSellable(raw.catalogue),
    isOwner: raw.is_owner === true,
  };
}

/** Share of finished visits the customer missed, whole percent; null when
 *  nothing has finished yet (a new customer has no rate, not 0%). */
export function noShowRate(completed: number, noShows: number): number | null {
  const finished = completed + noShows;
  return finished > 0 ? Math.round((noShows / finished) * 100) : null;
}

/** A chat with the customer in WhatsApp (wa.me needs the international
 *  number, digits only). null for a number that is not a mobile we know. */
export function whatsappChatUrl(phone: string): string | null {
  const e164 = toE164(phone);
  return e164 ? `https://wa.me/${e164.slice(1)}` : null;
}

/** The bookings page opens its manual form filled with this customer. */
export function bookingPrefillHref(file: Pick<CustomerFile, "name" | "phone" | "email">): string {
  const p = new URLSearchParams({ new: "1", name: file.name === "—" ? "" : file.name, phone: file.phone });
  if (file.email) p.set("email", file.email);
  return `/bookings?${p.toString()}`;
}

/** Tags as typed ("VIP، يحتاج متابعة, VIP"): split on Latin or Arabic
 *  commas, trimmed, empty and repeated ones dropped, order kept. `ok` is
 *  false when the result breaks the database's limits (0062). */
export function cleanTags(input: string): { tags: string[]; ok: boolean } {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of (input ?? "").split(/[,،]/)) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    tags.push(t);
  }
  return { tags, ok: tags.length <= TAG_MAX && tags.every((t) => t.length <= TAG_LEN) };
}
