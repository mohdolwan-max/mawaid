import "server-only";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkCode, d7Configured, resendCode, sendCode } from "@/lib/d7";
import { RESEND_AFTER_SECONDS, cleanCode, toE164 } from "@/lib/phoneCode";
import {
  VERIFIED_COOKIE,
  VERIFIED_COOKIE_MAX_AGE,
  deriveKey,
  hasProof,
  phoneProof,
  readProofs,
  writeProofs,
} from "@/lib/phoneVerify";

// The booking's phone check (0058), between the form and the booking.
//
// When it lets a booking through WITHOUT a code, and why — each is a
// deliberate choice, not an accident of error handling:
//   * D7_API_TOKEN unset: verification is not switched on yet.
//   * this device already verified this number: the owner's "once".
//   * 0058 not applied, or the provider down / refusing our token or
//     credit: a broken doorman must not close the shop (the rule 0040 set
//     for the source ceiling). Logged loudly, because while it lasts the
//     fake-booking guard is off. The booking ticket and the per-source
//     ceiling (0051) still hold.
// A code that was SENT is always required: once the customer has one,
// nothing fails open.

export type GateError =
  | "phone_invalid"
  | "verify_code_wrong"
  | "verify_code_expired"
  | "verify_too_many"
  | "verify_rate_limited"
  | "verify_phone_rejected"
  | "verify_unavailable"
  | "verify_resend_too_soon"
  | "verify_resend_limit";

export type Gate =
  | { pass: true }
  | { pass: false; verify: { id: string; resendAfter: number } }
  | { pass: false; error: GateError };

type Keys = { secret: string; device: Buffer; db: Buffer };

function keys(): Keys | null {
  const secret = process.env.BOOKING_SECRET;
  if (!secret) return null;
  return { secret, device: deriveKey(secret, "device"), db: deriveKey(secret, "db") };
}

async function remember(k: Keys, phone: string) {
  const store = await cookies();
  const proofs = readProofs(store.get(VERIFIED_COOKIE)?.value);
  store.set(VERIFIED_COOKIE, writeProofs(proofs, phoneProof(k.device, phone)), {
    path: "/",
    maxAge: VERIFIED_COOKIE_MAX_AGE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
}

const msg = (e: { message?: string } | null) => e?.message ?? "";

export async function phoneGate(input: {
  orgSlug: string;
  phone: string;
  sourceHash: string | null;
  verification?: { id: string; code: string } | null;
}): Promise<Gate> {
  if (!d7Configured()) return { pass: true };
  const k = keys();
  // Without BOOKING_SECRET the ticket refuses the booking anyway, with its
  // own clear error; nothing to add here.
  if (!k) return { pass: true };

  const e164 = toE164(input.phone);
  if (!e164) return { pass: false, error: "phone_invalid" };

  const store = await cookies();
  if (hasProof(readProofs(store.get(VERIFIED_COOKIE)?.value), phoneProof(k.device, input.phone))) {
    // Renewed on every booking, so a customer who keeps booking never
    // meets the browser's 400-day cap.
    await remember(k, input.phone);
    return { pass: true };
  }

  const supabase = await createClient();
  const phoneHash = phoneProof(k.db, input.phone);

  // ---- The customer typed a code. -------------------------------------
  if (input.verification) {
    const code = cleanCode(input.verification.code);
    // Not six digits: no guess is spent and the provider is not called.
    if (!code) return { pass: false, error: "verify_code_wrong" };

    const { data: providerId, error } = await supabase.rpc("phone_code_attempt", {
      p_secret: k.secret,
      p_id: input.verification.id,
      p_phone_hash: phoneHash,
      p_org_slug: input.orgSlug,
    });
    if (error) {
      const m = msg(error);
      if (m.includes("code_too_many")) return { pass: false, error: "verify_too_many" };
      if (m.includes("code_expired") || m.includes("code_not_found")) return { pass: false, error: "verify_code_expired" };
      console.error("phone_code_attempt failed", error);
      return { pass: false, error: "verify_unavailable" };
    }
    if (typeof providerId !== "string") return { pass: false, error: "verify_unavailable" };

    const outcome = await checkCode(providerId, code);
    if (outcome === "approved") {
      const { error: markErr } = await supabase.rpc("phone_code_verified", {
        p_secret: k.secret,
        p_id: input.verification.id,
      });
      if (markErr) console.error("phone_code_verified failed", markErr);
      await remember(k, input.phone);
      return { pass: true };
    }
    if (outcome === "wrong") return { pass: false, error: "verify_code_wrong" };
    if (outcome === "expired") return { pass: false, error: "verify_code_expired" };
    return { pass: false, error: "verify_unavailable" };
  }

  // ---- First time on this device: send a code. ------------------------
  const { data: id, error: openErr } = await supabase.rpc("phone_code_open", {
    p_secret: k.secret,
    p_org_slug: input.orgSlug,
    p_phone_hash: phoneHash,
    // Without an address the number's own ceiling still applies.
    p_source_hash: input.sourceHash ?? `noip:${phoneHash}`,
  });
  if (openErr) {
    if (msg(openErr).includes("rate_limited")) return { pass: false, error: "verify_rate_limited" };
    if (openErr.code === "PGRST202") {
      console.error("phone verification is ON but 0058 is not applied: booking without a code");
    } else {
      console.error("phone_code_open failed: booking without a code", openErr);
    }
    return { pass: true };
  }
  if (typeof id !== "string") return { pass: true };

  const sent = await sendCode(e164);
  if (sent.ok) {
    const { error: sentErr } = await supabase.rpc("phone_code_sent", {
      p_secret: k.secret,
      p_id: id,
      p_provider_id: sent.otpId,
    });
    if (sentErr) {
      // The SMS is out and the customer is waiting for it; without the
      // provider id we could not check their code, so say so now.
      console.error("phone_code_sent failed after the SMS went out", sentErr);
      return { pass: false, error: "verify_unavailable" };
    }
    return { pass: false, verify: { id, resendAfter: RESEND_AFTER_SECONDS } };
  }
  if (sent.kind === "rejected") return { pass: false, error: "verify_phone_rejected" };
  console.error(`D7 could not send (${sent.kind}): booking without a code`);
  return { pass: true };
}

export async function resendPhoneCode(input: {
  orgSlug: string;
  phone: string;
  verificationId: string;
}): Promise<{ ok: true; resendAfter: number } | { ok: false; error: GateError }> {
  const k = keys();
  if (!d7Configured() || !k) return { ok: false, error: "verify_unavailable" };
  if (!toE164(input.phone)) return { ok: false, error: "phone_invalid" };

  const supabase = await createClient();
  const { data: providerId, error } = await supabase.rpc("phone_code_resend_check", {
    p_secret: k.secret,
    p_id: input.verificationId,
    p_phone_hash: phoneProof(k.db, input.phone),
  });
  if (error) {
    const m = msg(error);
    if (m.includes("resend_too_soon")) return { ok: false, error: "verify_resend_too_soon" };
    if (m.includes("resend_limit")) return { ok: false, error: "verify_resend_limit" };
    if (m.includes("code_expired") || m.includes("code_not_found") || m.includes("code_used")) {
      return { ok: false, error: "verify_code_expired" };
    }
    console.error("phone_code_resend_check failed", error);
    return { ok: false, error: "verify_unavailable" };
  }
  if (typeof providerId !== "string") return { ok: false, error: "verify_unavailable" };

  const out = await resendCode(providerId);
  if (!out.ok) {
    if (out.kind === "too_soon") return { ok: false, error: "verify_resend_too_soon" };
    if (out.kind === "expired") return { ok: false, error: "verify_code_expired" };
    return { ok: false, error: "verify_unavailable" };
  }
  const { error: sentErr } = await supabase.rpc("phone_code_sent", {
    p_secret: k.secret,
    p_id: input.verificationId,
    p_provider_id: out.otpId,
  });
  if (sentErr) {
    console.error("phone_code_sent failed after a resend", sentErr);
    return { ok: false, error: "verify_unavailable" };
  }
  return { ok: true, resendAfter: RESEND_AFTER_SECONDS };
}
