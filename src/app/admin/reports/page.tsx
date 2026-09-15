import type { Metadata } from "next";
import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { getTaxRegistrations, getTaxReport } from "@/lib/adminServer";
import { ADMIN_TZ } from "@/lib/admin";
import { parsePeriod, periodSearch } from "@/lib/period";
import { PeriodPicker } from "../PeriodPicker";
import { PrintButton } from "./PrintButton";
import { TaxReportDocument } from "./TaxReportDocument";

type Params = { from?: string; to?: string; custom?: string; reg?: string };

// The PDF a browser saves is named after the page title.
export async function generateMetadata({ searchParams }: { searchParams: Promise<Params> }): Promise<Metadata> {
  const params = await searchParams;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ADMIN_TZ }).format(new Date());
  const period = parsePeriod(params, today);
  return { title: `sales-report_${period.from}_${period.to}` };
}

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [lang, params] = await Promise.all([getLang(), searchParams]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ADMIN_TZ }).format(new Date());
  const period = parsePeriod(params, today);
  const regs = await getTaxRegistrations();

  if (!regs) return <div className="empty">{t(lang, "admin_load_failed")}</div>;
  if (regs.registrations.length === 0) {
    return (
      <div className="admin-page">
        <div className="empty">
          <p>{t(lang, "report_no_registration")}</p>
          <Link href="/admin/tax" className="btn sm" style={{ marginTop: 10 }}>
            {t(lang, "report_add_registration")}
          </Link>
        </div>
      </div>
    );
  }

  // An inactive registration still reports: its invoices were real.
  const chosen =
    regs.registrations.find((r) => r.id === params.reg) ??
    regs.registrations.find((r) => r.active) ??
    regs.registrations[0];
  const report = await getTaxReport(chosen.id, period.from, period.to);

  return (
    <div className="admin-page">
      <div className="admin-toolbar no-print">
        <PeriodPicker lang={lang} path="/admin/reports" period={period} today={today} keep={{ reg: chosen.id }} />
        <PrintButton lang={lang} />
      </div>

      {regs.registrations.length > 1 && (
        <div className="admin-chips no-print" role="group" aria-label={t(lang, "report_registration")}>
          {regs.registrations.map((r) => (
            <Link
              key={r.id}
              href={`/admin/reports?${periodSearch(period, { reg: r.id })}`}
              aria-current={r.id === chosen.id ? "true" : undefined}
              className={r.id === chosen.id ? "on" : ""}
            >
              {r.country} · {r.currency} · {r.legalName}
              {!r.active && ` ${t(lang, "report_inactive")}`}
            </Link>
          ))}
        </div>
      )}

      {report ? (
        <TaxReportDocument lang={lang} report={report} />
      ) : (
        <div className="empty">{t(lang, "admin_load_failed")}</div>
      )}
    </div>
  );
}
