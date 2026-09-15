// Tax registrations and the printable sales report (0050). Free of React
// and the database so it can be tested directly.
//
// One number, one source: the database returns the lines, and every total
// on the report is summed here from those same lines, so the summary can
// never disagree with the detail under it. Money is summed in minor units
// (fils, halalas) because 0.1 + 0.2 is not 0.3 in floating point, and a
// tax total that is off by a fils is still wrong.

import { currencyCodeOrNull, num } from "@/lib/admin";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Matches _currency_decimals() in 0050. */
export function currencyDecimals(currency: string): number {
  return ["JOD", "KWD", "BHD", "OMR", "IQD", "LYD", "TND"].includes(currency.toUpperCase()) ? 3 : 2;
}

export type TaxRegistration = {
  id: string;
  country: string;
  currency: string;
  legalName: string;
  taxNumber: string;
  address: string | null;
  taxRate: number;
  timezone: string;
  invoicePrefix: string;
  nextInvoiceNo: number;
  active: boolean;
  invoices: number;
};

export type UnassignedSales = { currency: string; count: number; amount: number };

function parseRegistration(r: unknown): TaxRegistration | null {
  if (!isObj(r)) return null;
  const id = str(r.id);
  const currency = currencyCodeOrNull(r.currency);
  const country = typeof r.country === "string" && /^[A-Z]{2}$/.test(r.country) ? r.country : null;
  const legalName = str(r.legal_name);
  const taxNumber = str(r.tax_number);
  const taxRate = num(r.tax_rate);
  const timezone = str(r.timezone);
  const invoicePrefix = str(r.invoice_prefix);
  if (!id || !currency || !country || !legalName || !taxNumber || taxRate === null || !timezone || !invoicePrefix) {
    return null;
  }
  return {
    id,
    country,
    currency,
    legalName,
    taxNumber,
    address: str(r.address),
    taxRate,
    timezone,
    invoicePrefix,
    nextInvoiceNo: num(r.next_invoice_no) ?? 1,
    active: r.active === true,
    invoices: num(r.invoices) ?? 0,
  };
}

export function parseRegistrations(raw: unknown): { registrations: TaxRegistration[]; unassigned: UnassignedSales[] } | null {
  if (!isObj(raw) || !Array.isArray(raw.registrations) || !Array.isArray(raw.unassigned)) return null;
  const registrations: TaxRegistration[] = [];
  for (const r of raw.registrations) {
    const reg = parseRegistration(r);
    // A registration the page cannot read is not skipped: the list would
    // silently look shorter than it is.
    if (!reg) return null;
    registrations.push(reg);
  }
  const unassigned: UnassignedSales[] = [];
  for (const u of raw.unassigned) {
    if (!isObj(u)) return null;
    const currency = currencyCodeOrNull(u.currency);
    const count = num(u.count);
    const amount = num(u.amount);
    if (!currency || count === null || amount === null) return null;
    unassigned.push({ currency, count, amount });
  }
  return { registrations, unassigned };
}

export type ReportLine = {
  invoiceNo: string;
  /** When the money was taken; for a refund line, when it went back. */
  at: string;
  paidAt: string;
  buyerName: string;
  kind: "plan" | "offer";
  planId: string | null;
  period: "month" | "year" | null;
  itemTitle: string | null;
  provider: string | null;
  providerRef: string | null;
  isRenewal: boolean;
  amount: number;
  netAmount: number;
  taxAmount: number;
  taxRate: number;
  /** Sale lines: paid or refunded. Refund lines: always refunded. */
  status: string;
  note: string | null;
};

export type TaxReport = {
  generatedAt: string;
  from: string;
  to: string;
  registration: Omit<TaxRegistration, "nextInvoiceNo" | "invoices">;
  sales: ReportLine[];
  refunds: ReportLine[];
  unassigned: { count: number; amount: number };
};

function parseLine(l: unknown, atKey: "paid_at" | "refunded_at"): ReportLine | null {
  if (!isObj(l)) return null;
  const invoiceNo = str(l.invoice_no);
  const at = str(l[atKey]);
  const paidAt = str(l.paid_at);
  const amount = num(l.amount);
  const netAmount = num(l.net_amount);
  const taxAmount = num(l.tax_amount);
  const taxRate = num(l.tax_rate);
  if (!invoiceNo || !at || !paidAt || amount === null || netAmount === null || taxAmount === null || taxRate === null) {
    return null;
  }
  if (l.kind !== "plan" && l.kind !== "offer") return null;
  return {
    invoiceNo,
    at,
    paidAt,
    buyerName: str(l.buyer_name) ?? "—",
    kind: l.kind,
    planId: str(l.plan_id),
    period: l.period === "month" || l.period === "year" ? l.period : null,
    itemTitle: str(l.item_title),
    provider: str(l.provider),
    providerRef: str(l.provider_ref),
    isRenewal: l.is_renewal === true,
    amount,
    netAmount,
    taxAmount,
    taxRate,
    status: atKey === "refunded_at" ? "refunded" : (str(l.status) ?? "paid"),
    note: str(l.refund_note),
  };
}

/** null when any part is unreadable: a report with a line quietly missing
 *  is worse than no report. */
export function parseTaxReport(raw: unknown): TaxReport | null {
  if (!isObj(raw) || !isObj(raw.registration) || !Array.isArray(raw.sales) || !Array.isArray(raw.refunds)) return null;
  const generatedAt = str(raw.generated_at);
  const from = str(raw.from);
  const to = str(raw.to);
  const reg = parseRegistration({ ...raw.registration, next_invoice_no: 1, invoices: 0 });
  const u = isObj(raw.unassigned) ? raw.unassigned : null;
  const uCount = u ? num(u.count) : null;
  const uAmount = u ? num(u.amount) : null;
  if (!generatedAt || !from || !to || !reg || uCount === null || uAmount === null) return null;

  const sales: ReportLine[] = [];
  for (const l of raw.sales) {
    const line = parseLine(l, "paid_at");
    if (!line) return null;
    sales.push(line);
  }
  const refunds: ReportLine[] = [];
  for (const l of raw.refunds) {
    const line = parseLine(l, "refunded_at");
    if (!line) return null;
    refunds.push(line);
  }
  const { nextInvoiceNo: _n, invoices: _i, ...registration } = reg;
  void _n;
  void _i;
  return { generatedAt, from: from.slice(0, 10), to: to.slice(0, 10), registration, sales, refunds, unassigned: { count: uCount, amount: uAmount } };
}

export type Totals = { count: number; gross: number; net: number; tax: number };

export function sumLines(lines: readonly Pick<ReportLine, "amount" | "netAmount" | "taxAmount">[], currency: string): Totals {
  const f = 10 ** currencyDecimals(currency);
  let gross = 0;
  let net = 0;
  let tax = 0;
  for (const l of lines) {
    gross += Math.round(l.amount * f);
    net += Math.round(l.netAmount * f);
    tax += Math.round(l.taxAmount * f);
  }
  return { count: lines.length, gross: gross / f, net: net / f, tax: tax / f };
}

/** a − b, in minor units. */
export function subtractTotals(a: Totals, b: Totals, currency: string): Totals {
  const f = 10 ** currencyDecimals(currency);
  const d = (x: number, y: number) => (Math.round(x * f) - Math.round(y * f)) / f;
  return { count: a.count - b.count, gross: d(a.gross, b.gross), net: d(a.net, b.net), tax: d(a.tax, b.tax) };
}

export type GroupRow<K extends string> = { key: K; sales: Totals; refunds: Totals; net: Totals };

function groupBy<K extends string>(report: TaxReport, keyOf: (l: ReportLine) => K): GroupRow<K>[] {
  const cur = report.registration.currency;
  const keys: K[] = [];
  const sales = new Map<K, ReportLine[]>();
  const refunds = new Map<K, ReportLine[]>();
  const add = (m: Map<K, ReportLine[]>, l: ReportLine) => {
    const k = keyOf(l);
    if (!keys.includes(k)) keys.push(k);
    m.set(k, [...(m.get(k) ?? []), l]);
  };
  report.sales.forEach((l) => add(sales, l));
  report.refunds.forEach((l) => add(refunds, l));
  return keys.sort().map((key) => {
    const s = sumLines(sales.get(key) ?? [], cur);
    const r = sumLines(refunds.get(key) ?? [], cur);
    return { key, sales: s, refunds: r, net: subtractTotals(s, r, cur) };
  });
}

/** "YYYY-MM" of an instant, in the registration's calendar. */
export function monthIn(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).format(new Date(iso)).slice(0, 7);
}

export type ReportSummary = {
  sales: Totals;
  refunds: Totals;
  net: Totals;
  byKind: GroupRow<"plan" | "offer">[];
  byProvider: GroupRow<string>[];
  byMonth: GroupRow<string>[];
  byRate: GroupRow<string>[];
};

export function summarizeReport(report: TaxReport): ReportSummary {
  const cur = report.registration.currency;
  const sales = sumLines(report.sales, cur);
  const refunds = sumLines(report.refunds, cur);
  return {
    sales,
    refunds,
    net: subtractTotals(sales, refunds, cur),
    byKind: groupBy(report, (l) => l.kind),
    byProvider: groupBy(report, (l) => l.provider ?? "—"),
    byMonth: groupBy(report, (l) => monthIn(l.at, report.registration.timezone)),
    byRate: groupBy(report, (l) => l.taxRate.toFixed(2)),
  };
}

/** A registration form as typed, checked before it is sent. The database
 *  checks the same rules again; this only names the field. */
export type RegistrationInput = {
  country: string;
  currency: string;
  legalName: string;
  taxNumber: string;
  address: string;
  taxRate: string;
  timezone: string;
  invoicePrefix: string;
  active: boolean;
};

export type RegistrationField = "country" | "currency" | "legalName" | "taxNumber" | "taxRate" | "timezone" | "invoicePrefix";

export function registrationErrors(input: RegistrationInput): RegistrationField[] {
  const bad: RegistrationField[] = [];
  if (!/^[A-Z]{2}$/.test(input.country.trim().toUpperCase())) bad.push("country");
  if (!/^[A-Z]{3}$/.test(input.currency.trim().toUpperCase())) bad.push("currency");
  if ([...input.legalName.trim()].length < 2) bad.push("legalName");
  if ([...input.taxNumber.trim()].length < 2) bad.push("taxNumber");
  const rate = parseRate(input.taxRate);
  if (rate === null) bad.push("taxRate");
  if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(input.timezone.trim())) bad.push("timezone");
  if (!/^[A-Z0-9]{1,10}$/.test(input.invoicePrefix.trim().toUpperCase())) bad.push("invoicePrefix");
  return bad;
}

/** "16", "16.5", "١٦٫٥" -> a rate from 0 to 100 with at most 2 decimals;
 *  null for anything else, never 0. */
export function parseRate(v: string): number | null {
  const s = v
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".")
    .replace(/[%٪]$/, "")
    .trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : null;
}
