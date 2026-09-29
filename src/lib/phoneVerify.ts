// Phone verification at booking (0058): the device proof. Server side
// (node:crypto); the parts the form also needs live in phoneCode.ts.
// Free of React, the database and the network so it can be tested
// directly (ENGINEERING-STANDARDS §4).
//
// Owner's decisions, 2026-09-29:
//   * the SMS the platform sends is a code at the end of booking, and it
//     is what proves a real person with a real phone made the booking;
//   * a number is verified ONCE. Here that means once per device: the
//     proof lives in a cookie on the phone that received the code. Bound
//     to the number alone, anyone could type a verified customer's number
//     on another device and book in their name with no code, which is the
//     exact fake-booking hole this closes (0040 named it: "Closing that
//     needs OTP").

import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizePhone } from "@/lib/phone";

export const VERIFIED_COOKIE = "mawaid_pv";
/** Browsers cap a cookie's life at 400 days; every booking renews it. */
export const VERIFIED_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;
/** Numbers one device may keep verified: a parent books for the family. */
export const VERIFIED_MAX = 5;

/** A key per purpose, derived from one server secret, so the device proof
 *  and the database's rate-limit hash can never be swapped for each other. */
export function deriveKey(secret: string, purpose: "device" | "db"): Buffer {
  return createHmac("sha256", secret).update(`maw3ed-phone-verify-v1|${purpose}`).digest();
}

/** Stands for "this device verified this number". 22 base64url characters
 *  (132 bits): unguessable, and it names no number to anyone reading the
 *  cookie. Only the server, holding the key, can make one. The same
 *  number typed as 079…, +962 79… or in Arabic digits gives one proof. */
export function phoneProof(key: Buffer, phone: string): string {
  return createHmac("sha256", key).update(normalizePhone(phone)).digest("base64url").slice(0, 22);
}

const PROOF_SHAPE = /^[A-Za-z0-9_-]{22}$/;

/** The proofs a cookie holds. Anything malformed is ignored, not trusted:
 *  a hand-edited cookie can only lose proofs, never add a working one,
 *  because a working one has to match phoneProof() under the server key. */
export function readProofs(cookieValue: string | undefined | null): string[] {
  if (!cookieValue || !cookieValue.startsWith("v1.")) return [];
  return cookieValue
    .slice(3)
    .split(".")
    .filter((p) => PROOF_SHAPE.test(p))
    .slice(0, VERIFIED_MAX);
}

/** The cookie after adding a proof: newest first, no repeats, capped. */
export function writeProofs(existing: string[], proof: string): string {
  const next = [proof, ...existing.filter((p) => p !== proof)].slice(0, VERIFIED_MAX);
  return "v1." + next.join(".");
}

export function hasProof(proofs: string[], proof: string): boolean {
  const want = Buffer.from(proof);
  return proofs.some((p) => {
    const have = Buffer.from(p);
    return have.length === want.length && timingSafeEqual(have, want);
  });
}
