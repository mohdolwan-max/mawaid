import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";

// Identifies the SOURCE of a booking request without ever handling — let
// alone storing — an address. The database side (0040) sees only this
// hash and counts how many bookings came from it recently; the point is
// to stop one person filling a clinic's week, while the honest customer
// is never asked for anything.
//
// Salted with CRON_SECRET (already set, server-only, never in the repo)
// so the stored hashes cannot be matched back to an address by anyone
// holding the table. Rotating that secret resets every counter, which is
// harmless — worst case a few limits start over.

export async function currentSourceHash(): Promise<string | null> {
  const h = await headers();
  // x-forwarded-for is a chain; the client is the FIRST entry. Taking
  // the last would key the limit on the CDN edge and throttle a whole
  // region as if it were one person.
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip")?.trim() || null;
  if (!ip) return null;

  const salt = process.env.CRON_SECRET ?? "maw3ed-source";
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex");
}
