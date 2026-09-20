import "server-only";
import { timingSafeEqual } from "node:crypto";

// The cron and payment-status routes compared their bearer token with
// !==, which returns as soon as two bytes differ. The PayTabs webhook
// already used a constant-time compare (lib/payments/paytabsCore.ts);
// the audit (2026-09-20) flagged the inconsistency, and one comparison
// used in four places is easier to keep right than four copies.
//
// Fails closed: no header, no configured secret, or a different length
// all return false.
export function bearerOk(authHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const given = Buffer.from(authHeader, "utf8");
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
