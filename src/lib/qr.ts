// A clinic's QR code (0060): the link it opens, and how a visit that came
// from it is recognised. Free of React, the browser and the database so it
// can be tested directly (ENGINEERING-STANDARDS §4).
//
// Owner's decision, 2026-10-25: every subscribing clinic gets a QR code
// and a printable poster, and its report says how many bookings the code
// brought in.

import { clinicShareUrl } from "@/lib/share";

/** The only sources a booking can be marked with (0060's check). */
export type BookingSource = "qr";

export const QR_PARAM = "src";
export const QR_VALUE = "qr";

/** The link inside the printed code: the clinic's public page, marked.
 *  Built from the canonical site host, never the current origin, so a
 *  poster printed from a preview deployment still opens the real site. */
export function clinicQrUrl(siteBase: string, slug: string): string {
  return `${clinicShareUrl(siteBase, slug)}?${QR_PARAM}=${QR_VALUE}`;
}

/** "qr" when the page was opened from the code, else null. Anything else
 *  in the parameter is ignored, not stored: the query string is anyone's
 *  to edit, and a source must be one the database accepts. */
export function sourceFromSearch(search: string | null | undefined): BookingSource | null {
  if (!search) return null;
  try {
    return new URLSearchParams(search).get(QR_PARAM) === QR_VALUE ? "qr" : null;
  } catch {
    return null;
  }
}

// The visit is remembered for the browser tab (sessionStorage), per
// clinic, for a few hours: scanning, reading the clinic page, then booking
// is one sitting. A tab reopened days later is a new visit, not the poster.
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
    if (v?.s !== "qr" || typeof v.at !== "number" || !Number.isFinite(v.at)) return null;
    const age = now - v.at;
    return age >= 0 && age <= SOURCE_TTL_MS ? "qr" : null;
  } catch {
    return null;
  }
}

/** Server-side guard for what the booking form sends. */
export function isBookingSource(v: unknown): v is BookingSource {
  return v === "qr";
}

// The symbol in the middle of the code. Error correction H restores up to
// 30% of the code, and a centre patch of this size covers well under that
// (the test decodes the finished picture to prove it scans).
export const QR_LOGO_FRACTION = 0.22;
