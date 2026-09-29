import "server-only";
import {
  CODE_LENGTH,
  CODE_MESSAGE,
  CODE_TTL_SECONDS,
  RESEND_AFTER_SECONDS,
  readResend,
  readSend,
  readVerify,
  type ResendOutcome,
  type SendOutcome,
  type VerifyOutcome,
} from "@/lib/phoneCode";

// D7 Networks' Verify API: it makes the code, sends it and checks it, so
// no code is ever stored on our side. Chosen by the owner on 2026-09-29
// for its local Jordan rate (0.018 USD a message against 0.32 for
// international traffic, and 0.44 at Twilio).
//
// Settings, in Vercel only (never in the repo):
//   D7_API_TOKEN   the account's API token. Unset = verification is off
//                  and booking works exactly as before 0058.
//   D7_ORIGINATOR  the approved sender name ("Maw3ed"). Until D7 approves
//                  it, leave it unset and D7 sends from its own name.
//   D7_BASE_URL    tests only: a stand-in server, so the whole flow can be
//                  exercised without sending a real message. Never set in
//                  production.

const BASE = `${process.env.D7_BASE_URL ?? "https://api.d7networks.com"}/verify/v1/otp`;
// A booking waits on this call; past this the customer is better served
// by the fail-open path than by a spinner.
const TIMEOUT_MS = 8000;

export function d7Configured(): boolean {
  return !!process.env.D7_API_TOKEN;
}

async function post(path: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.D7_API_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

export async function sendCode(e164: string): Promise<SendOutcome> {
  try {
    const originator = process.env.D7_ORIGINATOR?.trim();
    const { status, json } = await post("send-otp", {
      recipient: e164,
      ...(originator ? { originator } : {}),
      content: CODE_MESSAGE,
      data_coding: "unicode",
      expiry: CODE_TTL_SECONDS,
      otp_code_length: CODE_LENGTH,
      otp_type: "numeric",
      retry_delay: RESEND_AFTER_SECONDS,
      retry_count: 2,
    });
    const out = readSend(status, json);
    if (!out.ok) console.error("D7 send-otp refused", status, JSON.stringify(json));
    return out;
  } catch (e) {
    console.error("D7 send-otp failed", e);
    return { ok: false, kind: "outage" };
  }
}

export async function resendCode(otpId: string): Promise<ResendOutcome> {
  try {
    const { status, json } = await post("resend-otp", { otp_id: otpId });
    const out = readResend(status, json);
    if (!out.ok && (out.kind === "config" || out.kind === "outage")) {
      console.error("D7 resend-otp failed", status, JSON.stringify(json));
    }
    return out;
  } catch (e) {
    console.error("D7 resend-otp failed", e);
    return { ok: false, kind: "outage" };
  }
}

export async function checkCode(otpId: string, code: string): Promise<VerifyOutcome> {
  try {
    const { status, json } = await post("verify-otp", { otp_id: otpId, otp_code: code });
    const out = readVerify(status, json);
    if (out === "config" || out === "outage") console.error("D7 verify-otp failed", status, JSON.stringify(json));
    return out;
  } catch (e) {
    console.error("D7 verify-otp failed", e);
    return "outage";
  }
}
