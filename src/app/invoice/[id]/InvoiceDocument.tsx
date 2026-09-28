import { cityLabel } from "@/lib/directory";
import { currencyLabel } from "@/lib/billing";
import { isPlanId, planName } from "@/lib/plan";
import { invoiceAmount, invoiceDate, invoiceRate, type Invoice } from "@/lib/invoice";

// The tax invoice, in Arabic whatever language the page around it is in:
// it is a tax document of Jordan or Saudi Arabia, and both keep them in
// Arabic. Layout approved by the owner on 2026-09-28 (the mock with the
// symbol and the teal wordmark, Cairo, no site address under the logo).

// The tax's own name in each country, on the tax line and its column.
const TAX_NAME: Record<string, string> = {
  JO: "ضريبة المبيعات",
  SA: "ضريبة القيمة المضافة",
};

export function InvoiceDocument({ inv, countryName }: { inv: Invoice; countryName: (code: string | null) => string }) {
  const tz = inv.seller.timezone;
  // Dates and the rate are left-to-right runs inside an Arabic line; each is
  // isolated so the line cannot reorder it (it printed "%16" and 2026/09/28).
  const date = (iso: string | null, withTime = false) => (
    <bdi dir="ltr">{iso ? invoiceDate(iso, tz, withTime) : "—"}</bdi>
  );
  // An offer's days are calendar days, printed as stored.
  const day = (ymd: string | null) => <bdi dir="ltr">{ymd ? ymd.split("-").reverse().join("/") : "—"}</bdi>;
  const money = (n: number) => `${invoiceAmount(n, inv.currency)} ${inv.currency}`;
  const tax = TAX_NAME[inv.country] ?? "الضريبة";
  const rate = <bdi dir="ltr">{invoiceRate(inv.taxRate)}%</bdi>;

  const description =
    inv.kind === "offer"
      ? `إعلان عرض على موعد: ${inv.itemTitle ?? "—"}`
      : `اشتراك موعد، ${inv.planId && isPlanId(inv.planId) ? `الباقة ${planName(inv.planId, "ar")}` : "الباقة"}${
          inv.period === "year" ? " (سنوي)" : inv.period === "month" ? " (شهري)" : ""
        }`;
  const period =
    inv.kind === "offer" ? (
      <>
        {day(inv.offerStart)} إلى {day(inv.offerEnd)}
      </>
    ) : inv.planEndsAt ? (
      <>ساري حتى {date(inv.planEndsAt)}</>
    ) : (
      "—"
    );

  return (
    <article className="inv-sheet" dir="rtl" lang="ar">
      <header className="inv-top">
        <div className="inv-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="inv-sym" src="/brand/symbol-128.png" alt="" width={128} height={128} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="inv-word" src="/brand/wordmark-ar-teal.png" alt="موعد" width={640} height={149} />
        </div>
        <div className="inv-title">
          <h1>فاتورة ضريبية</h1>
          <p className="inv-en">Tax Invoice</p>
          <dl className="inv-meta">
            <dt>رقم الفاتورة</dt>
            <dd dir="ltr">{inv.invoiceNo}</dd>
            <dt>تاريخ الإصدار</dt>
            <dd>{date(inv.invoicedAt, true)}</dd>
            <dt>تاريخ الدفع</dt>
            <dd>{date(inv.paidAt, true)}</dd>
          </dl>
        </div>
      </header>

      <section className="inv-parties">
        <div className="inv-party">
          <h2>البائع</h2>
          <p>{inv.seller.legalName}</p>
          <p>
            الرقم الضريبي: <span dir="ltr">{inv.seller.taxNumber}</span>
          </p>
          <p>{[inv.seller.address, countryName(inv.seller.country)].filter(Boolean).join("، ")}</p>
        </div>
        <div className="inv-party">
          <h2>المشتري</h2>
          <p>{inv.buyer.name}</p>
          <p>{[inv.buyer.city ? cityLabel(inv.buyer.city, "ar") : null, countryName(inv.buyer.country)].filter(Boolean).join("، ")}</p>
        </div>
      </section>

      <div className="inv-table-wrap">
        <table className="inv-table">
          <thead>
            <tr>
              <th>الوصف</th>
              <th>الفترة</th>
              <th className="num">المبلغ قبل الضريبة</th>
              <th className="num">
                {tax} {rate}
              </th>
              <th className="num">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                {description}
                {inv.isRenewal && <span className="inv-sub">تجديد تلقائي</span>}
              </td>
              <td>{period}</td>
              <td className="num">{money(inv.netAmount)}</td>
              <td className="num">{money(inv.taxAmount)}</td>
              <td className="num">{money(inv.amount)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="inv-totals">
        <div className="inv-notes">
          <p>الأسعار شاملة {tax}.</p>
          <p>
            طريقة الدفع: بطاقة عبر بوابة الدفع
            {inv.providerRef && (
              <>
                ، مرجع العملية <span dir="ltr">{inv.providerRef}</span>
              </>
            )}
          </p>
          {inv.status === "refunded" ? (
            <span className="inv-stamp refunded">
              مستردة{inv.refundedAt && <> بتاريخ {date(inv.refundedAt)}</>}
            </span>
          ) : (
            <span className="inv-stamp">مدفوعة</span>
          )}
        </div>
        <dl className="inv-sum">
          <div>
            <dt>المجموع قبل الضريبة</dt>
            <dd dir="ltr">{money(inv.netAmount)}</dd>
          </div>
          <div>
            <dt>
              {tax} ({rate})
            </dt>
            <dd dir="ltr">{money(inv.taxAmount)}</dd>
          </div>
          <div className="inv-grand">
            <dt>الإجمالي المدفوع</dt>
            <dd dir="ltr">
              {invoiceAmount(inv.amount, inv.currency)} {currencyLabel(inv.currency, "ar")}
            </dd>
          </div>
        </dl>
      </section>

      <footer className="inv-foot">صدرت هذه الفاتورة إلكترونياً من منصة موعد، ولا تحتاج إلى توقيع أو ختم.</footer>
    </article>
  );
}
