// Phone shape, in one place, free of React and the database so it can be
// tested directly (ENGINEERING-STANDARDS §4).
//
// Why this exists: until now nothing checked the SHAPE of a customer's
// number anywhere — the database normalised punctuation away and stored
// whatever was left, so "1" became "01" and was accepted. A booking with
// an unreachable number is a slot the clinic loses AND a customer it
// cannot warn, and the customer cannot undo it either (owner, 2026-09).
//
// This must stay in lockstep with public._norm_phone (0027): same digit
// folding, same country-code stripping. The SQL side is the authority —
// this is the copy that lets the browser answer instantly.

/** Arabic-Indic and Extended Arabic-Indic digits → ASCII. */
const DIGIT_MAP: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** "+962 79 123 4567" / "٠٧٩١٢٣٤٥٦٧" → "0791234567". Never throws. */
export function normalizePhone(input: string): string {
  const digits = (input ?? "")
    .split("")
    .map((c) => DIGIT_MAP[c] ?? c)
    .join("")
    .replace(/[^0-9]/g, "");

  if (digits === "") return "";
  if (digits.startsWith("00962")) return "0" + digits.slice(5);
  if (digits.startsWith("962")) return "0" + digits.slice(3);
  if (digits.startsWith("0020")) return "0" + digits.slice(4);
  if (digits.startsWith("20") && digits.length >= 12) return "0" + digits.slice(2);
  if (digits.startsWith("0")) return digits;
  return "0" + digits;
}

// Jordan mobile: 07 + 8 digits. Egypt mobile: 01 + 9 digits — the app is
// for Jordan with Egypt next, and a rule wider than the countries served
// would let the typos back in. Landlines are deliberately NOT accepted:
// a booking's number has to receive a reminder.
const JORDAN_MOBILE = /^07\d{8}$/;
const EGYPT_MOBILE = /^01\d{9}$/;

export function isValidPhone(input: string): boolean {
  const n = normalizePhone(input);
  return JORDAN_MOBILE.test(n) || EGYPT_MOBILE.test(n);
}

/** "0791234567" → "079 123 4567", for reading a number back to someone
 *  before they commit to it. Falls back to the raw normalised digits for
 *  anything that is not a shape we recognise. */
export function formatPhoneForDisplay(input: string): string {
  const n = normalizePhone(input);
  if (JORDAN_MOBILE.test(n)) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  if (EGYPT_MOBILE.test(n)) return `${n.slice(0, 3)} ${n.slice(3, 7)} ${n.slice(7)}`;
  return n;
}
