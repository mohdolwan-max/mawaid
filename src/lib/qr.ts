// Where a booking came from: the clinic's QR code (0060) and its links for
// Google, Instagram and the other places it puts one (0065). The link each
// place opens, and how a visit that came from it is recognised. Free of
// React, the browser and the database so it can be tested directly
// (ENGINEERING-STANDARDS §4).
//
// Owner's decisions, 2026-10-25: every subscribing clinic gets a QR code
// and a printable poster, and its report says how many bookings the code
// brought in (0060); then "booking buttons on Google and Instagram"
// (roadmap item 5). Google's own booking button and Instagram's "Book now"
// action button only accept those companies' partners, but a Google
// Business Profile takes an appointment link from any business and an
// Instagram profile takes a website link, so each place gets its own
// marked link and the report counts each one.

import { clinicShareUrl } from "@/lib/share";

/** Every source a booking can be marked with (0065's check), in the order
 *  the clinic's screens list them. */
export const BOOKING_SOURCES = ["qr", "google", "instagram", "facebook", "tiktok", "whatsapp"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];
/** The ones the clinic places as a link (the QR code has its own poster). */
export const LINK_SOURCES = BOOKING_SOURCES.filter((s) => s !== "qr") as Exclude<BookingSource, "qr">[];

const KNOWN = new Set<string>(BOOKING_SOURCES);

export const QR_PARAM = "src";
export const QR_VALUE = "qr";

/** The clinic's public page, marked with where the visitor came from.
 *  Built from the canonical site host, never the current origin, so a
 *  link copied from a preview deployment still opens the real site. */
export function clinicSourceUrl(siteBase: string, slug: string, source: BookingSource): string {
  return `${clinicShareUrl(siteBase, slug)}?${QR_PARAM}=${source}`;
}

/** The link inside the printed code. */
export function clinicQrUrl(siteBase: string, slug: string): string {
  return clinicSourceUrl(siteBase, slug, "qr");
}

/** Server-side guard for what the booking form sends. */
export function isBookingSource(v: unknown): v is BookingSource {
  return typeof v === "string" && KNOWN.has(v);
}

/** The source the page was opened from, else null. Anything else in the
 *  parameter is ignored, not stored: the query string is anyone's to
 *  edit, and a source must be one the database accepts. */
export function sourceFromSearch(search: string | null | undefined): BookingSource | null {
  if (!search) return null;
  try {
    const v = new URLSearchParams(search).get(QR_PARAM);
    return isBookingSource(v) ? v : null;
  } catch {
    return null;
  }
}

// The visit is remembered for the browser tab (sessionStorage), per
// clinic, for a few hours: opening the link, reading the clinic page, then
// booking is one sitting. A tab reopened days later is a new visit.
export const SOURCE_TTL_MS = 3 * 60 * 60 * 1000;
export const sourceStorageKey = (slug: string) => `maw3ed_src:${slug}`;

export function encodeStoredSource(source: BookingSource, now: number): string {
  return JSON.stringify({ s: source, at: now });
}

/** The stored source if it is known and still fresh, else null. */
export function decodeStoredSource(raw: string | null | undefined, now: number): BookingSource | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { s?: unknown; at?: unknown };
    if (!isBookingSource(v?.s) || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    const age = now - v.at;
    return age >= 0 && age <= SOURCE_TTL_MS ? v.s : null;
  } catch {
    return null;
  }
}

// The symbol in the middle of the code. Error correction H restores up to
// 30% of the code, and a centre patch of this size covers well under that
// (the test decodes the finished picture to prove it scans).
export const QR_LOGO_FRACTION = 0.22;
