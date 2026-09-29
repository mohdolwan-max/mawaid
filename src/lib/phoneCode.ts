// The booking code (0058): the parts the booking form and the server both
// need, free of node:crypto so the browser bundle can import them. The
// device proof lives in phoneVerify.ts, server side.

import { normalizePhone, isValidPhone } from "@/lib/phone";

export const CODE_LENGTH = 6;
export const CODE_TTL_SECONDS = 600;
export const RESEND_AFTER_SECONDS = 60;

/** The SMS. D7 puts the code where {} is. Arabic goes out as UCS-2, where
 *  one message holds 70 characters; this stays well inside one message so
 *  every code costs one message, never two. */
export const CODE_MESSAGE = "رمز تأكيد حجزك في موعد: {}";

/** "0791234567" → "+962791234567", "01012345678" → "+201012345678".
 *  null for anything the booking form would not accept. */
export function toE164(input: string): string | null {
  if (!isValidPhone(input)) return null;
  const n = normalizePhone(input);
  if (n.startsWith("07")) return "+962" + n.slice(1);
  if (n.startsWith("01")) return "+20" + n.slice(1);
  return null;
}

const DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** What the code field shows while typing: ASCII digits only, at most six.
 *  Arabic digits with a space between them display their groups reversed
 *  even in a left-to-right field (measured: "٤٨٢ ٩١٣" showed as ٩١٣ ٤٨٢),
 *  so the field never holds anything but plain digits. */
export function codeDigits(input: string): string {
  return (input ?? "")
    .split("")
    .map((c) => DIGITS[c] ?? c)
    .join("")
    .replace(/[^0-9]/g, "")
    .slice(0, CODE_LENGTH);
}

/** The code as typed — Arabic digits, spaces, a pasted "482 913" — as six
 *  ASCII digits, or null when it cannot be a code (no provider call, no
 *  attempt spent). */
export function cleanCode(input: string): string | null {
  const digits = (input ?? "")
    .split("")
    .map((c) => DIGITS[c] ?? c)
    .join("")
    .replace(/[^0-9]/g, "");
  return digits.length === CODE_LENGTH ? digits : null;
}

// ---------------------------------------------------------------------
// D7 Verify API responses, read in one place. Documented at
// d7networks.com/docs/verify: send-otp answers { otp_id, status: "OPEN",
// expiry }; verify-otp answers { status } with APPROVED, FAILED, EXPIRED
// or ALREADY_VERIFIED, or 400 INVALID_OTP_CODE; resend-otp answers a new
// otp_id, or 400 when it is too soon or the code has expired.
// ---------------------------------------------------------------------

export type SendOutcome =
  | { ok: true; otpId: string }
  /** The number itself was refused (422/400): tell the customer. */
  | { ok: false; kind: "rejected" }
  /** Our side: bad token (401) or no credit (402). */
  | { ok: false; kind: "config" }
  /** Their side or the network: 5xx, timeout, unreadable answer. */
  | { ok: false; kind: "outage" };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const otpIdOf = (body: unknown): string | null =>
  isObj(body) && typeof body.otp_id === "string" && body.otp_id !== "" ? body.otp_id : null;

export function readSend(status: number, body: unknown): SendOutcome {
  if (status >= 200 && status < 300) {
    const otpId = otpIdOf(body);
    // A 200 without an id cannot be verified later: treat it as not sent.
    return otpId ? { ok: true, otpId } : { ok: false, kind: "outage" };
  }
  if (status === 401 || status === 402 || status === 403) return { ok: false, kind: "config" };
  if (status === 400 || status === 422) return { ok: false, kind: "rejected" };
  return { ok: false, kind: "outage" };
}

export type ResendOutcome =
  | { ok: true; otpId: string }
  | { ok: false; kind: "too_soon" | "expired" | "config" | "outage" };

export function readResend(status: number, body: unknown): ResendOutcome {
  if (status >= 200 && status < 300) {
    const otpId = otpIdOf(body);
    return otpId ? { ok: true, otpId } : { ok: false, kind: "outage" };
  }
  if (status === 401 || status === 402 || status === 403) return { ok: false, kind: "config" };
  if (status === 400) {
    const text = JSON.stringify(body ?? "").toLowerCase();
    if (text.includes("frequent")) return { ok: false, kind: "too_soon" };
    return { ok: false, kind: "expired" };
  }
  return { ok: false, kind: "outage" };
}

export type VerifyOutcome = "approved" | "wrong" | "expired" | "config" | "outage";

export function readVerify(status: number, body: unknown): VerifyOutcome {
  if (status >= 200 && status < 300) {
    const s = isObj(body) && typeof body.status === "string" ? body.status.toUpperCase() : "";
    if (s === "APPROVED" || s === "ALREADY_VERIFIED") return "approved";
    if (s === "EXPIRED") return "expired";
    if (s === "FAILED") return "wrong";
    return "outage";
  }
  // "Invalid OTP code or OTP code expired": one answer for both, and the
  // customer's next step is the same either way — check the code or ask
  // for a new one. Our own record (0058) knows when the code expired.
  if (status === 400) return "wrong";
  if (status === 401 || status === 402 || status === 403) return "config";
  return "outage";
}
