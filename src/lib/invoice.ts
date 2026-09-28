// A clinic's invoice (0057): shape, parsing and the numbers it prints.
// Free of React and the database so it can be tested directly.
//
// Every amount comes from the payment's own snapshot (0050): the invoice
// prints what was charged and taxed at the moment of payment, never a
// figure recomputed from today's prices or rates.

import { currencyDecimals } from "@/lib/taxReport";

export type Invoice = {
  id: string;
  invoiceNo: string;
  invoicedAt: string;
  paidAt: string | null;
  status: "paid" | "refunded" | "needs_refund";
  refundedAt: string | null;
  country: string;
  currency: string;
  amount: number;
  netAmount: number;
  taxAmount: number;
  taxRate: number;
  kind: "plan" | "offer";
  planId: string | null;
  period: "month" | "year" | null;
  planEndsAt: string | null;
  isRenewal: boolean;
  itemTitle: string | null;
  offerStart: string | null;
  offerEnd: string | null;
  providerRef: string | null;
  buyer: { name: string; city: string | null; country: string | null; slug: string | null };
  seller: { legalName: string; taxNumber: string; address: string | null; country: string; timezone: string };
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** null when the payload is not a whole invoice. A document missing its
 *  number, its seller or any of its amounts is not shown half-filled. */
export function parseInvoice(raw: unknown): Invoice | null {
  if (!isObj(raw) || !isObj(raw.seller) || !isObj(raw.buyer)) return null;
  const id = str(raw.id);
  const invoiceNo = str(raw.invoice_no);
  const invoicedAt = str(raw.invoiced_at);
  const country = str(raw.country);
  const currency = str(raw.currency);
  const amount = num(raw.amount);
  const netAmount = num(raw.net_amount);
  const taxAmount = num(raw.tax_amount);
  const taxRate = num(raw.tax_rate);
  const legalName = str(raw.seller.legal_name);
  const taxNumber = str(raw.seller.tax_number);
  const status = raw.status;
  const kind = raw.kind;
  if (
    !id || !invoiceNo || !invoicedAt || !country || !currency || !legalName || !taxNumber ||
    amount === null || netAmount === null || taxAmount === null || taxRate === null ||
    (status !== "paid" && status !== "refunded" && status !== "needs_refund") ||
    (kind !== "plan" && kind !== "offer")
  ) {
    return null;
  }
  return {
    id,
    invoiceNo,
    invoicedAt,
    paidAt: str(raw.paid_at),
    status,
    refundedAt: str(raw.refunded_at),
    country,
    currency,
    amount,
    netAmount,
    taxAmount,
    taxRate,
    kind,
    planId: str(raw.plan_id),
    period: raw.period === "month" || raw.period === "year" ? raw.period : null,
    planEndsAt: str(raw.plan_ends_at),
    isRenewal: raw.is_renewal === true,
    itemTitle: str(raw.item_title),
    offerStart: str(raw.offer_start),
    offerEnd: str(raw.offer_end),
    providerRef: str(raw.provider_ref),
    buyer: {
      name: str(raw.buyer.name) ?? "—",
      city: str(raw.buyer.city),
      country: str(raw.buyer.country),
      slug: str(raw.buyer.slug),
    },
    seller: {
      legalName,
      taxNumber,
      address: str(raw.seller.address),
      country: str(raw.seller.country) ?? country,
      timezone: str(raw.seller.timezone) ?? "Asia/Amman",
    },
  };
}

/** An invoice amount at its currency's full precision, as a tax document
 *  prints it: 19.000 JOD, 269.00 SAR. Western digits. */
export function invoiceAmount(n: number, currency: string): string {
  return Number.isFinite(n) ? n.toFixed(currencyDecimals(currency)) : "—";
}

/** "28/09/2026" or "28/09/2026 14:32" in the seller's timezone, day
 *  first, Western digits. Built from parts, not an Arabic locale string:
 *  that one carries direction marks which, inside a right-to-left line,
 *  printed the date as 2026/09/28. The caller sets dir="ltr" on it. */
export function invoiceDate(iso: string, timeZone: string, withTime = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  const day = `${parts.day}/${parts.month}/${parts.year}`;
  return withTime ? `${day} ${parts.hour}:${parts.minute}` : day;
}

/** The rate as printed: 16, 15, 7.5 (no trailing zeros). */
export function invoiceRate(rate: number): string {
  return Number.isFinite(rate) ? String(Number(rate.toFixed(2))) : "—";
}
