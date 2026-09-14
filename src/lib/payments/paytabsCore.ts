import { createHmac, timingSafeEqual } from "node:crypto";

// PayTabs, the pure half: signatures and reading a transaction. No network
// and no environment, so it can be tested directly. The network half is
// ./paytabs.ts.
//
// Sources (PayTabs documentation, read 2026-09):
//   * Endpoint base per region: secure-jordan.paytabs.com, secure.paytabs.sa,
//     ... ("What is my region / endpoint URL?").
//   * Callback: POST, JSON body, header "Signature" = HMAC-SHA256 of the
//     entire raw body keyed with the profile server key.
//   * payment_result.response_status: A authorised, P pending, H on hold,
//     D declined, E error. Anything not A/P/H is treated as not paid.
//   * Token: returned only after the payment, as "token" in the callback
//     and in a query; recurring charges use tran_class "recurring".

export const PAYTABS_JORDAN_BASE = "https://secure-jordan.paytabs.com";

export function signBody(rawBody: string, serverKey: string): string {
  return createHmac("sha256", serverKey).update(rawBody, "utf8").digest("hex");
}

/** Constant-time comparison, so the check leaks nothing about the key. */
export function signatureValid(rawBody: string, header: string | null, serverKey: string): boolean {
  if (!header || !serverKey) return false;
  const expected = Buffer.from(signBody(rawBody, serverKey), "utf8");
  const given = Buffer.from(header.trim().toLowerCase(), "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export type PaytabsTxn = {
  tran_ref?: string;
  cart_id?: string;
  cart_amount?: string | number;
  cart_currency?: string;
  tran_total?: string | number;
  tran_currency?: string;
  token?: string;
  payment_result?: { response_status?: string; response_code?: string; response_message?: string };
  payment_info?: { card_scheme?: string; payment_description?: string };
};

export type Classified =
  | {
      outcome: "paid";
      /** NaN when unreadable; confirm_payment then records needs_refund. */
      amount: number;
      /** What PayTabs says it charged in; the database compares it. */
      currency: string | null;
      providerRef: string;
      token: string | null;
      cardLabel: string | null;
    }
  | { outcome: "failed"; providerRef: string; reason: string }
  | { outcome: "pending"; providerRef: string };

/** "Visa 1111" from the scheme and the masked number PayTabs reports. */
export function cardLabel(info: PaytabsTxn["payment_info"]): string | null {
  const scheme = info?.card_scheme?.trim();
  const last4 = info?.payment_description?.match(/(\d{4})\s*$/)?.[1];
  const label = [scheme, last4].filter(Boolean).join(" ");
  return label || null;
}

function chargedAmount(txn: PaytabsTxn): number {
  // tran_total is what was charged; a create-request echo carries "0".
  const total = Number(txn.tran_total);
  if (Number.isFinite(total) && total > 0) return total;
  const cart = Number(txn.cart_amount);
  return Number.isFinite(cart) && cart > 0 ? cart : Number.NaN;
}

function chargedCurrency(txn: PaytabsTxn): string | null {
  const code = (txn.tran_currency ?? txn.cart_currency ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export function classify(txn: PaytabsTxn): Classified | null {
  const ref = txn.tran_ref?.trim();
  if (!ref) return null;
  const status = txn.payment_result?.response_status?.trim().toUpperCase();

  if (status === "A") {
    return {
      outcome: "paid",
      amount: chargedAmount(txn),
      currency: chargedCurrency(txn),
      providerRef: ref,
      token: txn.token?.trim() || null,
      cardLabel: cardLabel(txn.payment_info),
    };
  }
  if (status === "P" || status === "H") return { outcome: "pending", providerRef: ref };

  const reason = [status ?? "no_status", txn.payment_result?.response_code, txn.payment_result?.response_message]
    .filter(Boolean)
    .join(" ")
    .slice(0, 300);
  return { outcome: "failed", providerRef: ref, reason };
}

// A renewal needs the saved token and, for PayTabs recurring charges, the
// reference of the transaction that created it. Kept together as one
// mandate reference so the database stays gateway-neutral (0047).
const SEP = "|";

export function packMandate(token: string, tranRef: string): string {
  return `${token}${SEP}${tranRef}`;
}

export function unpackMandate(ref: string): { token: string; tranRef: string } | null {
  const i = ref.indexOf(SEP);
  if (i <= 0 || i === ref.length - 1) return null;
  return { token: ref.slice(0, i), tranRef: ref.slice(i + 1) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Our payment id travels as the PayTabs cart_id. */
export function isPaymentId(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}
