"use client";

import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { niceMax } from "@/lib/admin";
import { formatAmount } from "@/lib/billing";
import type { Bucket, BucketSize } from "@/lib/period";

// One series over the chosen period (dataviz): columns from one baseline,
// capped at 24px with a 4px rounded top and a 2px gap, a single series so
// no legend (the title names it), a readout that follows hover and
// keyboard focus, and a table view so no value depends on hovering.
// Color #0d9488 passed the palette validator on the light surface
// (lightness, chroma, >= 3:1 contrast); the brand teal read as gray there.
// A bar is a day, a week or a month depending on the period's length
// (lib/period.ts bucketSize), so a year is 12 bars rather than 366.
export function DailyBars({
  lang,
  title,
  subtitle,
  points,
  size,
  unit,
}: {
  lang: Lang;
  title: string;
  subtitle: string;
  points: Bucket[];
  size: BucketSize;
  /** A currency label for money, or null for counts. */
  unit: string | null;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const max = niceMax(points.map((p) => p.value));
  const locale = intlLocale(lang);
  const day = (ymd: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(new Date(`${ymd}T00:00:00Z`));
  const fmtBucket = (b: Bucket) => {
    if (size === "month") return day(b.start, { month: "short", year: "numeric" });
    if (b.start === b.end) return day(b.start, { day: "numeric", month: "short" });
    return `${day(b.start, { day: "numeric", month: "short" })} – ${day(b.end, { day: "numeric", month: "short" })}`;
  };
  const fmtVal = (v: number) => (unit ? `${formatAmount(v)} ${unit}` : formatAmount(v));
  const shown = active ?? points.length - 1;
  const readout = points[shown];
  const allZero = points.every((p) => p.value === 0);

  return (
    <div className="card admin-chart">
      <div className="ac-head">
        <div>
          <p className="ac-title">{title}</p>
          <p className="hint">{subtitle}</p>
        </div>
        {points.length > 0 && (
          <button type="button" className="btn ghost sm" onClick={() => setAsTable((v) => !v)}>
            {t(lang, asTable ? "admin_chart_chart" : "admin_chart_table")}
          </button>
        )}
      </div>

      {points.length === 0 ? (
        <div className="empty">{t(lang, "admin_chart_empty")}</div>
      ) : asTable ? (
        <div className="ac-table-wrap">
          <table className="ac-table">
            <thead>
              <tr>
                <th>{t(lang, size === "day" ? "admin_chart_day" : "admin_chart_span")}</th>
                <th>{t(lang, "admin_chart_value")}</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.start}>
                  <td>{fmtBucket(p)}</td>
                  <td className="num">{fmtVal(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <p className="ac-readout" aria-live="polite">
            {readout && (
              <>
                <strong>{fmtVal(readout.value)}</strong> <span>{fmtBucket(readout)}</span>
              </>
            )}
          </p>
          <div className="ac-plot">
            <div className="ac-yaxis" aria-hidden="true">
              <span>{fmtVal(max)}</span>
              <span>{fmtVal(max / 2)}</span>
              <span>0</span>
            </div>
            <div className="ac-main">
              <div className="ac-bars" onPointerLeave={() => setActive(null)}>
                {points.map((p, i) => {
                  const pct = (p.value / max) * 100;
                  return (
                    <button
                      key={p.start}
                      type="button"
                      className={`ac-bar${i === shown ? " on" : ""}`}
                      aria-label={`${fmtBucket(p)}: ${fmtVal(p.value)}`}
                      onPointerEnter={() => setActive(i)}
                      onFocus={() => setActive(i)}
                      onBlur={() => setActive(null)}
                    >
                      <span style={{ height: p.value > 0 ? `max(2px, ${pct}%)` : 0 }} />
                    </button>
                  );
                })}
              </div>
              <div className="ac-axis" aria-hidden="true">
                <span>{fmtBucket(points[0])}</span>
                <span>{fmtBucket(points[points.length - 1])}</span>
              </div>
            </div>
          </div>
          {allZero && <p className="hint">{t(lang, "admin_chart_empty")}</p>}
        </>
      )}
    </div>
  );
}
