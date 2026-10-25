// The waitlist (0066): shapes, parsing and the small rules the pages and
// the email share. Free of React and the database so it can be tested
// directly (ENGINEERING-STANDARDS §4).

import { isValidPhone, normalizePhone } from "@/lib/phone";
import { bookHref } from "@/lib/serviceSelection";
import { toE164 } from "@/lib/phoneCode";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export const WAITLIST_NAME_MAX = 80;

export type WaitlistEntry = {
  id: string;
  /** YYYY-MM-DD, the clinic's day. */
  day: string;
  serviceIds: string[];
  serviceNames: string[];
  staffId: string | null;
  name: string;
  phone: string;
  email: string | null;
  createdAt: string;
  /** Last time a booked time that day was given up; null = not since joining. */
  freedAt: string | null;
  notifiedAt: string | null;
};

/** A date column reaches us as "2026-10-28" or "2026-10-28T00:00:00Z". */
const ymd = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function parseWaitlist(raw: unknown): WaitlistEntry[] {
  const out: WaitlistEntry[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const day = isObj(r) ? ymd(r.day) : null;
    if (!isObj(r) || typeof r.id !== "string" || !day || typeof r.phone !== "string") continue;
    out.push({
      id: r.id,
      day,
      serviceIds: strArr(r.service_ids),
      serviceNames: strArr(r.service_names),
      staffId: str(r.staff_id),
      name: str(r.customer_name) ?? "—",
      phone: r.phone,
      email: str(r.email),
      createdAt: str(r.created_at) ?? "",
      freedAt: str(r.freed_at),
      notifiedAt: str(r.notified_at),
    });
  }
  return out;
}

/** Entries grouped by day, days in order, each day's entries first come
 *  first. */
export function groupByDay(entries: readonly WaitlistEntry[]): { day: string; entries: WaitlistEntry[] }[] {
  const map = new Map<string, WaitlistEntry[]>();
  for (const e of [...entries].sort((a, b) => a.day.localeCompare(b.day) || a.createdAt.localeCompare(b.createdAt))) {
    const list = map.get(e.day);
    if (list) list.push(e);
    else map.set(e.day, [e]);
  }
  return [...map.entries()].map(([day, list]) => ({ day, entries: list }));
}

/** The booking page opened on the day asked for, with the visit chosen. */
export function waitlistBookHref(slug: string, serviceIds: readonly string[], day: string): string {
  const base = bookHref(slug, serviceIds);
  return `${base}${base.includes("?") ? "&" : "?"}date=${encodeURIComponent(day)}`;
}

/** Reads ?date= for the booking page: a real calendar day from today up
 *  to the furthest day the page may offer, else null (the page starts
 *  on today as before). */
export function parseBookDate(raw: string | string[] | undefined, today: string, maxDay?: string): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  if (v < today || (maxDay && v > maxDay)) return null;
  return v;
}

export type WaitlistFormError = "wl_err_name" | "wl_err_phone" | "wl_err_email";

/** The join form as typed; the database checks the same again. */
export function checkWaitlistForm(input: { name: string; phone: string; email: string }): WaitlistFormError | null {
  const name = input.name.trim();
  if (name.length < 1 || name.length > WAITLIST_NAME_MAX) return "wl_err_name";
  if (!isValidPhone(input.phone)) return "wl_err_phone";
  const email = input.email.trim();
  if (email !== "" && (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return "wl_err_email";
  return null;
}

/** A WhatsApp chat with the customer, the clinic's message typed in. */
export function waitlistWhatsappUrl(phone: string, message: string): string | null {
  const e164 = toE164(normalizePhone(phone));
  return e164 ? `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(message)}` : null;
}
