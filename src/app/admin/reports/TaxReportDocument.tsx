import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { isPlanId, planName } from "@/lib/plan";
import {
  currencyDecimals,
  summarizeReport,
  sumLines,
  type GroupRow,
  type ReportLine,
  type TaxReport,
  type Totals,
} from "@/lib/taxReport";

// The printable sales report. Every figure comes from summarizeReport(),
// which sums the same lines listed at the bottom, so a total can always be
// checked by hand against the detail.

const PROVIDER_LABEL: Record<string, string> = { paytabs: "PayTabs" };

export function TaxReportDocument({ lang, report }: { lang: Lang; report: TaxReport }) {
  const reg = report.registration;
  const cur = reg.currency;
  const dec = currencyDecimals(cur);
  const locale = intlLocale(lang);
  const summary = summarizeReport(report);

  const money = (n: number) => n.toLocaleString(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const negative = (n: number) => (n === 0 ? money(0) : `−${money(n)}`);
  const count = (n: number) => n.toLocaleString(locale);
  const day = (ymd: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "long" }).format(new Date(`${ymd}T00:00:00Z`));
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      timeZone: reg.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  const month = (key: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${key}-01T00:00:00Z`));
  const country = (() => {
    try {
      return new Intl.DisplayNames([locale], { type: "region" }).of(reg.country) ?? reg.country;
    } catch {
      return reg.country;
    }
  })();
  const rate = (n: number) => `${n.toLocaleString(locale, { maximumFractionDigits: 2 })}%`;
  const provider = (p: string | null) => (p ? (PROVIDER_LABEL[p] ?? p) : "—");
  const item = (l: ReportLine) =>
    l.kind === "offer"
      ? t(lang, "billing_item_offer", { title: l.itemTitle ?? "—" })
      : t(lang, "billing_item_plan", {
          plan: l.planId && isPlanId(l.planId) ? planName(l.planId, lang) : (l.planId ?? "—"),
          period: l.period ? t(lang, l.period === "year" ? "billing_period_year" : "billing_period_month") : "",
        });

  function GroupTable<K extends string>({ title, head, rows, label }: { title: TKey; head: TKey; rows: GroupRow<K>[]; label: (k: K) => string }) {
    return (
      <section className="tr-section">
        <h3>{t(lang, title)}</h3>
        <div className="tr-scroll">
          <table className="tr-table">
            <thead>
              <tr>
                <th>{t(lang, head)}</th>
                <th className="num">{t(lang, "report_row_sales")}</th>
                <th className="num">{t(lang, "report_row_refunds")}</th>
                <th className="num">{t(lang, "report_col_net")}</th>
                <th className="num">{t(lang, "report_col_tax")}</th>
                <th className="num">{t(lang, "report_col_gross")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{label(r.key)}</td>
                  <td className="num">{money(r.sales.gross)}</td>
                  <td className="num">{negative(r.refunds.gross)}</td>
                  <td className="num">{money(r.net.net)}</td>
                  <td className="num">{money(r.net.tax)}</td>
                  <td className="num">{money(r.net.gross)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{t(lang, "report_total")}</td>
                <td className="num">{money(summary.sales.gross)}</td>
                <td className="num">{negative(summary.refunds.gross)}</td>
                <td className="num">{money(summary.net.net)}</td>
                <td className="num">{money(summary.net.tax)}</td>
                <td className="num">{money(summary.net.gross)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    );
  }

  const summaryRow = (label: TKey, x: Totals, sign: 1 | -1) => {
    const f = sign === 1 ? money : negative;
    return (
      <tr>
        <td>{t(lang, label)}</td>
        <td className="num">{count(x.count)}</td>
        <td className="num">{f(x.net)}</td>
        <td className="num">{f(x.tax)}</td>
        <td className="num">{f(x.gross)}</td>
      </tr>
    );
  };

  const empty = report.sales.length === 0 && report.refunds.length === 0;
  const refundTotals = sumLines(report.refunds, cur);

  return (
    <article className="tax-report">
      <header className="tr-head">
        <div className="tr-seller">
          <h1>{reg.legalName}</h1>
          <p>{t(lang, "report_tax_number", { n: reg.taxNumber })}</p>
          {reg.address && <p>{reg.address}</p>}
          <p>{t(lang, "report_country", { c: country })}</p>
        </div>
        <div className="tr-meta">
          <h2>{t(lang, "report_title")}</h2>
          <p>{t(lang, "report_period", { from: day(report.from), to: day(report.to) })}</p>
          <p>{t(lang, "report_currency", { c: cur })}</p>
          <p>{t(lang, "report_issued", { d: when(report.generatedAt) })}</p>
          <p className="tr-muted">{t(lang, "report_timezone", { tz: reg.timezone })}</p>
        </div>
      </header>

      {report.unassigned.count > 0 && (
        <p className="tr-warning">
          {t(lang, "report_unassigned", { n: count(report.unassigned.count), amount: `${money(report.unassigned.amount)} ${cur}` })}
        </p>
      )}

      <section className="tr-section tr-summary">
        <h3>{t(lang, "report_summary")}</h3>
        <div className="tr-scroll">
          <table className="tr-table">
            <thead>
              <tr>
                <th />
                <th className="num">{t(lang, "report_col_count")}</th>
                <th className="num">{t(lang, "report_col_net")}</th>
                <th className="num">{t(lang, "report_col_tax")}</th>
                <th className="num">{t(lang, "report_col_gross")}</th>
              </tr>
            </thead>
            <tbody>
              {summaryRow("report_row_sales", summary.sales, 1)}
              {summaryRow("report_row_refunds", summary.refunds, -1)}
            </tbody>
            <tfoot>
              <tr>
                <td>{t(lang, "report_row_net")}</td>
                <td className="num">—</td>
                <td className="num">{money(summary.net.net)}</td>
                <td className="num">{money(summary.net.tax)}</td>
                <td className="num">{money(summary.net.gross)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {!empty && (
        <div className="tr-grid">
          <GroupTable title="report_by_rate" head="report_col_rate" rows={summary.byRate} label={(k) => rate(Number(k))} />
          <GroupTable title="report_by_month" head="report_col_month" rows={summary.byMonth} label={month} />
          <GroupTable
            title="report_by_kind"
            head="report_col_kind"
            rows={summary.byKind}
            label={(k) => t(lang, k === "plan" ? "report_kind_plan" : "report_kind_offer")}
          />
          <GroupTable title="report_by_provider" head="report_col_provider" rows={summary.byProvider} label={(k) => provider(k === "—" ? null : k)} />
        </div>
      )}

      <section className="tr-section">
        <h3>{t(lang, "report_sales_detail")}</h3>
        {report.sales.length === 0 ? (
          <p className="tr-muted">{t(lang, "report_empty_sales")}</p>
        ) : (
          <div className="tr-scroll">
            <table className="tr-table">
              <thead>
                <tr>
                  <th className="num">{t(lang, "report_col_no")}</th>
                  <th>{t(lang, "report_col_invoice")}</th>
                  <th>{t(lang, "report_col_paid_at")}</th>
                  <th>{t(lang, "report_col_buyer")}</th>
                  <th>{t(lang, "report_col_item")}</th>
                  <th>{t(lang, "report_col_provider")}</th>
                  <th>{t(lang, "report_col_ref")}</th>
                  <th className="num">{t(lang, "report_col_net")}</th>
                  <th className="num">{t(lang, "report_col_rate")}</th>
                  <th className="num">{t(lang, "report_col_tax")}</th>
                  <th className="num">{t(lang, "report_col_gross")}</th>
                </tr>
              </thead>
              <tbody>
                {report.sales.map((l, i) => (
                  <tr key={l.invoiceNo}>
                    <td className="num">{count(i + 1)}</td>
                    <td dir="ltr" className="tr-ref">{l.invoiceNo}</td>
                    <td className="num">{when(l.at)}</td>
                    <td>{l.buyerName}</td>
                    <td>
                      {item(l)}
                      {l.isRenewal && <span className="tr-muted"> · {t(lang, "report_renewal")}</span>}
                      {l.status === "refunded" && <span className="tr-muted"> · {t(lang, "report_refunded_note")}</span>}
                    </td>
                    <td>{provider(l.provider)}</td>
                    <td dir="ltr" className="tr-ref">{l.providerRef ?? "—"}</td>
                    <td className="num">{money(l.netAmount)}</td>
                    <td className="num">{rate(l.taxRate)}</td>
                    <td className="num">{money(l.taxAmount)}</td>
                    <td className="num">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>{t(lang, "report_total")}</td>
                  <td className="num">{money(summary.sales.net)}</td>
                  <td />
                  <td className="num">{money(summary.sales.tax)}</td>
                  <td className="num">{money(summary.sales.gross)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="tr-section">
        <h3>{t(lang, "report_refunds_detail")}</h3>
        {report.refunds.length === 0 ? (
          <p className="tr-muted">{t(lang, "report_empty_refunds")}</p>
        ) : (
          <div className="tr-scroll">
            <table className="tr-table">
              <thead>
                <tr>
                  <th className="num">{t(lang, "report_col_no")}</th>
                  <th>{t(lang, "report_col_invoice")}</th>
                  <th>{t(lang, "report_col_refunded_at")}</th>
                  <th>{t(lang, "report_col_paid_at")}</th>
                  <th>{t(lang, "report_col_buyer")}</th>
                  <th>{t(lang, "report_col_item")}</th>
                  <th className="num">{t(lang, "report_col_net")}</th>
                  <th className="num">{t(lang, "report_col_tax")}</th>
                  <th className="num">{t(lang, "report_col_gross")}</th>
                  <th>{t(lang, "report_col_note")}</th>
                </tr>
              </thead>
              <tbody>
                {report.refunds.map((l, i) => (
                  <tr key={l.invoiceNo}>
                    <td className="num">{count(i + 1)}</td>
                    <td dir="ltr" className="tr-ref">{l.invoiceNo}</td>
                    <td className="num">{when(l.at)}</td>
                    <td className="num">{when(l.paidAt)}</td>
                    <td>{l.buyerName}</td>
                    <td>{item(l)}</td>
                    <td className="num">{negative(l.netAmount)}</td>
                    <td className="num">{negative(l.taxAmount)}</td>
                    <td className="num">{negative(l.amount)}</td>
                    <td>{l.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>{t(lang, "report_total")}</td>
                  <td className="num">{negative(refundTotals.net)}</td>
                  <td className="num">{negative(refundTotals.tax)}</td>
                  <td className="num">{negative(refundTotals.gross)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <footer className="tr-foot">{t(lang, "report_footer", { currency: cur })}</footer>
    </article>
  );
}
