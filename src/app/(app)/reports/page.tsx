import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { currencyLabel } from "@/lib/billing";
import { intlLocale, todayYMD } from "@/lib/date";
import type { StaffMember } from "@/lib/types";
import { staffOwnerLabel } from "@/lib/staffLabel";
import { bucketSeries, bucketSize, parsePeriod } from "@/lib/period";
import { changePct } from "@/lib/admin";
import {
  averageVisitValue,
  busiestWeekday,
  noShowRate,
  parseOrgReport,
  previousNoShowRate,
  sourceRows,
  topServices,
  trackedBookings,
} from "@/lib/orgReport";
import { PeriodPicker } from "@/components/PeriodPicker";
import { branchTotals, parseBranchSummary } from "@/lib/branches";
import { formatPrice } from "@/lib/billing";
import { DailyBars } from "@/components/DailyBars";
import { StatTile } from "@/components/StatTile";

// What an owner asks at the end of a month: how many visits, how many
// turned up, what it was worth, and which service and which staff member
// carried it. Everything is for the chosen period, counted on the day of
// the VISIT — "how did last month go" is a question about the diary, not
// about when the bookings were typed in.
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; custom?: string }>;
}) {
  const ctx = await requireOrgContext();
  const params = await searchParams;
  const today = todayYMD(ctx.timezone);
  const period = parsePeriod(params, today);
  const lang: Lang = ctx.lang;
  const locale = intlLocale(lang);
  const money = (v: number) =>
    `${v.toLocaleString(locale, { maximumFractionDigits: 2 })} ${currencyLabel(ctx.currency, lang)}`;
  const count = (v: number) => v.toLocaleString(locale);

  const head = (
    <div className="page-head">
      <div>
        <h2>{t(lang, "nav_reports")}</h2>
        <p className="sub">{t(lang, "reports_sub")}</p>
      </div>
    </div>
  );

  // Revenue belongs to the person who owns it. A staff member sees the
  // dashboard and their own calendar, not the clinic's takings.
  if (ctx.role !== "owner") {
    return (
      <div>
        {head}
        <div className="card">
          <p className="hint">{t(lang, "reports_owner_only")}</p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data, error }, { data: staffRows }, branchesRes] = await Promise.all([
    supabase.rpc("org_report", { p_from: period.from, p_to: period.to }),
    supabase.rpc("list_org_staff", { p_org_id: ctx.orgId }),
    // Every clinic the owner has (0071), when more than one.
    supabase.rpc("branches_summary", { p_from: period.from, p_to: period.to }),
  ]);
  if (branchesRes.error && branchesRes.error.code !== "PGRST202") console.error("branches_summary failed", branchesRes.error);
  const branches = branchesRes.error ? [] : parseBranchSummary(branchesRes.data);

  const report = error ? null : parseOrgReport(data);
  if (!report) {
    if (error) console.error("org_report failed", error);
    return (
      <div>
        {head}
        <PeriodPicker lang={lang} path="/reports" period={period} today={today} />
        <div className="card" style={{ marginTop: 12 }}>
          <p className="error-text">{t(lang, "error_generic")}</p>
        </div>
      </div>
    );
  }

  const staffLabel = new Map<string, string>();
  ((staffRows as StaffMember[]) ?? []).forEach((m) => {
    if (m.membership_id) staffLabel.set(m.membership_id, staffOwnerLabel(m, lang));
  });

  const size = bucketSize(period.from, period.to);
  const chartSub = t(
    lang,
    size === "day" ? "admin_chart_by_day" : size === "week" ? "admin_chart_by_week" : "admin_chart_by_month"
  );
  const visits = bucketSeries(report.series.map((d) => ({ day: d.day, value: d.total })), period.from, period.to);
  const value = bucketSeries(report.series.map((d) => ({ day: d.day, value: d.value })), period.from, period.to);

  const visitsPct = changePct(report.totals.total, report.previous.total);
  const valuePct = changePct(report.money.completedValue, report.money.previousValue);
  const pk = report.packages;
  // Shown once the clinic offers packages, or sold one in the period
  // (a retired catalogue still has sales to report).
  const showPackages = pk !== null && (pk.catalogue > 0 || pk.sold > 0 || pk.refunded > 0);
  const vs = (pct: number | null) =>
    pct === null ? t(lang, "reports_no_compare") : t(lang, "reports_vs_prev", { pct: `${pct > 0 ? "+" : ""}${pct}` });

  const rate = noShowRate(report);
  const prevRate = previousNoShowRate(report);
  const avg = averageVisitValue(report);
  const busiest = busiestWeekday(report.series);
  // 2024-09-01 was a Sunday, so adding the weekday index names the day.
  const weekdayName = (weekday: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2024, 8, 1 + weekday))
    );

  const services = topServices(report.byService, 8);
  // The QR code (0060) and the clinic's links for Google, Instagram and
  // the rest (0065): which of them brought the bookings in.
  const tracked = trackedBookings(report);
  const sources = sourceRows(report);
  const staff = [...report.byStaff].sort((a, b) => b.total - a.total);

  return (
    <div>
      {head}
      <PeriodPicker lang={lang} path="/reports" period={period} today={today} />

      {branches.length > 1 && (
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ fontWeight: 700, marginBottom: 4 }}>{t(lang, "branch_report_title")}</p>
          <p className="hint" style={{ marginBottom: 10 }}>{t(lang, "branch_report_hint")}</p>
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>{t(lang, "branch_col")}</th>
                  <th className="num">{t(lang, "reports_col_visits")}</th>
                  <th className="num">{t(lang, "reports_col_completed")}</th>
                  <th className="num">{t(lang, "reports_col_no_show")}</th>
                  <th className="num">{t(lang, "reports_col_value")}</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => (
                  <tr key={b.orgId}>
                    <td>
                      {b.name}
                      {b.orgId === ctx.orgId && <span className="chip good">{t(lang, "branch_current")}</span>}
                    </td>
                    <td className="num">{count(b.visits)}</td>
                    <td className="num">{count(b.completed)}</td>
                    <td className="num">{count(b.noShows)}</td>
                    <td className="num">{formatPrice(b.value, b.currency, lang)}</td>
                  </tr>
                ))}
                {branchTotals(branches).map((tot) => (
                  <tr key={tot.currency} className="ac-total">
                    <td>{t(lang, "branch_total")}</td>
                    <td className="num">{count(tot.visits)}</td>
                    <td className="num">{count(tot.completed)}</td>
                    <td className="num"></td>
                    <td className="num">{formatPrice(tot.value, tot.currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="admin-tiles" style={{ marginTop: 12 }}>
        <StatTile
          emphasis
          label={t(lang, "reports_kpi_visits")}
          value={count(report.totals.total)}
          sub={[
            vs(visitsPct),
            t(lang, "reports_kpi_mix", {
              completed: count(report.totals.completed),
              booked: count(report.totals.booked),
              cancelled: count(report.totals.cancelled),
            }),
          ].join(" · ")}
        />
        <StatTile
          label={t(lang, "reports_kpi_value")}
          value={money(report.money.completedValue)}
          sub={[
            vs(valuePct),
            report.money.unpriced > 0
              ? t(lang, "reports_value_unpriced", { n: count(report.money.unpriced) })
              : avg !== null
                ? t(lang, "reports_value_avg", { amount: money(avg) })
                : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        />
        {showPackages && pk && (
          <StatTile
            label={t(lang, "reports_kpi_packages")}
            value={money(pk.soldValue)}
            sub={[
              t(lang, "reports_packages_sold", { n: count(pk.sold) }),
              vs(changePct(pk.soldValue, pk.previousSoldValue)),
              pk.refunded > 0 ? t(lang, "reports_packages_refunded", { amount: money(pk.refunded) }) : "",
              t(lang, "reports_packages_used", { n: count(report.money.fromPackages) }),
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        )}
        <StatTile
          label={t(lang, "reports_kpi_no_show")}
          value={rate === null ? "—" : `${count(rate)}%`}
          sub={
            rate === null
              ? t(lang, "reports_no_finished")
              : [
                  t(lang, "reports_no_show_count", { n: count(report.totals.noShow) }),
                  prevRate === null ? "" : t(lang, "reports_no_show_prev", { pct: count(prevRate) }),
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
          tone={rate !== null && rate >= 20 ? "warn" : null}
        />
        <StatTile
          label={t(lang, "reports_kpi_customers")}
          value={count(report.customers.people)}
          sub={t(lang, "reports_kpi_new_customers", { n: count(report.customers.new) })}
        />
        {tracked && (
          <StatTile
            label={t(lang, "reports_kpi_links")}
            value={count(tracked.count)}
            sub={[
              report.totals.total > 0
                ? t(lang, "reports_qr_share", { pct: count(Math.round((tracked.count / report.totals.total) * 100)) })
                : "",
              t(lang, "reports_qr_prev", { n: count(tracked.previous) }),
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        )}
        <StatTile
          label={t(lang, "reports_kpi_busiest")}
          value={busiest === null ? "—" : weekdayName(busiest.weekday)}
          sub={busiest === null ? t(lang, "reports_empty_period") : t(lang, "reports_busiest_count", { n: count(busiest.total) })}
        />
      </div>

      {showPackages && <p className="hint" style={{ marginTop: 8 }}>{t(lang, "reports_packages_note")}</p>}

      <section className="admin-charts" style={{ marginTop: 16 }}>
        <DailyBars
          lang={lang}
          title={t(lang, "reports_chart_visits")}
          subtitle={chartSub}
          size={size}
          points={visits}
          unit={null}
        />
        <DailyBars
          lang={lang}
          title={t(lang, "reports_chart_value")}
          subtitle={chartSub}
          size={size}
          points={value}
          unit={currencyLabel(ctx.currency, lang)}
        />
      </section>

      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "reports_by_service")}</p>
        {services.length === 0 ? (
          <div className="empty">{t(lang, "reports_empty_period")}</div>
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>{t(lang, "reports_col_service")}</th>
                  <th className="num">{t(lang, "reports_col_visits")}</th>
                  <th className="num">{t(lang, "reports_col_completed")}</th>
                  <th className="num">{t(lang, "reports_col_no_show")}</th>
                  <th className="num">{t(lang, "reports_col_value")}</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.serviceId}>
                    <td>{s.name}</td>
                    <td className="num">{count(s.total)}</td>
                    <td className="num">{count(s.completed)}</td>
                    <td className="num">{count(s.noShow)}</td>
                    <td className="num">{money(s.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "reports_by_staff")}</p>
        {staff.length === 0 ? (
          <div className="empty">{t(lang, "reports_empty_period")}</div>
        ) : (
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>{t(lang, "reports_col_staff")}</th>
                  <th className="num">{t(lang, "reports_col_visits")}</th>
                  <th className="num">{t(lang, "reports_col_completed")}</th>
                  <th className="num">{t(lang, "reports_col_no_show")}</th>
                  <th className="num">{t(lang, "reports_col_value")}</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.staffId ?? "none"}>
                    <td>
                      {s.staffId === null
                        ? t(lang, "reports_staff_none")
                        : (staffLabel.get(s.staffId) ?? t(lang, "reports_staff_gone"))}
                    </td>
                    <td className="num">{count(s.total)}</td>
                    <td className="num">{count(s.completed)}</td>
                    <td className="num">{count(s.noShow)}</td>
                    <td className="num">{money(s.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {report.sources && (
        <div className="card" style={{ marginTop: 12 }}>
          <p style={{ fontWeight: 700, marginBottom: 4 }}>{t(lang, "reports_by_source")}</p>
          <p className="hint" style={{ marginBottom: 10 }}>{t(lang, "reports_by_source_hint")}</p>
          {sources.length === 0 ? (
            <div className="empty">{t(lang, "reports_no_source")}</div>
          ) : (
            <div className="ac-table-wrap">
              <table className="ac-table">
                <thead>
                  <tr>
                    <th>{t(lang, "reports_col_source")}</th>
                    <th className="num">{t(lang, "reports_col_visits")}</th>
                    <th className="num">{t(lang, "reports_col_share")}</th>
                    <th className="num">{t(lang, "reports_col_previous")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((r) => (
                    <tr key={r.source}>
                      <td>{t(lang, `source_${r.source}` as TKey)}</td>
                      <td className="num">{count(r.count)}</td>
                      <td className="num">{r.share === null ? "—" : `${count(r.share)}%`}</td>
                      <td className="num">{count(r.previous)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
