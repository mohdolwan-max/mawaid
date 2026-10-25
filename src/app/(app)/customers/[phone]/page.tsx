import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { formatPrice } from "@/lib/billing";
import { formatPhoneForDisplay } from "@/lib/phone";
import { staffOwnerLabel } from "@/lib/staffLabel";
import type { StaffMember } from "@/lib/types";
import { StatTile } from "@/components/StatTile";
import { bookingPrefillHref, noShowRate, parseCustomerFile, whatsappChatUrl } from "@/lib/customerFile";
import { CustomerTags, CustomerNotes } from "./CustomerTools";
import { CustomerPackages, VisitPackage } from "./PackageTools";

// One customer's file at this clinic (0062): the figures, every visit, and
// the clinic's private tags and notes. get_org_customer decides the clinic
// from the caller; a number the clinic never booked has no file.
export default async function CustomerPage({ params }: { params: Promise<{ phone: string }> }) {
  const ctx = await requireOrgContext();
  const lang = ctx.lang;
  const { phone } = await params;
  const supabase = await createClient();
  const [{ data, error }, { data: staffRows }] = await Promise.all([
    supabase.rpc("get_org_customer", { p_phone: decodeURIComponent(phone) }),
    supabase.rpc("list_org_staff", { p_org_id: ctx.orgId }),
  ]);

  if (error) {
    console.error("get_org_customer failed", error);
    return (
      <div className="card">
        <p className="error-text">{t(lang, "error_generic")}</p>
      </div>
    );
  }
  const file = parseCustomerFile(data);
  if (!file) notFound();

  const locale = intlLocale(lang);
  const count = (n: number) => n.toLocaleString(locale);
  const day = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { timeZone: ctx.timezone, dateStyle: "medium" }).format(new Date(iso)) : "—";
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: ctx.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const staffLabel = new Map<string, string>();
  ((staffRows as StaffMember[]) ?? []).forEach((m) => {
    if (m.membership_id) staffLabel.set(m.membership_id, staffOwnerLabel(m, lang));
  });
  const rate = noShowRate(file.completed, file.noShows);
  const wa = whatsappChatUrl(file.phone);
  const statusKey: Record<string, TKey> = {
    booked: "booking_status_booked",
    completed: "booking_status_completed",
    cancelled: "booking_status_cancelled",
    no_show: "booking_status_no_show",
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <Link href="/customers" className="hint">
            {t(lang, "cust_back")}
          </Link>
          <h2 style={{ marginTop: 4 }}>{file.name}</h2>
          <p className="sub">
            <bdi dir="ltr">{formatPhoneForDisplay(file.phone)}</bdi>
            {file.email && (
              <>
                {" · "}
                <bdi dir="ltr">{file.email}</bdi>
              </>
            )}
          </p>
        </div>
        <div className="toolbar">
          <Link href={bookingPrefillHref(file)} className="btn sm">
            {t(lang, "cust_new_booking")}
          </Link>
          <a href={`tel:${file.phone}`} className="btn ghost sm">
            {t(lang, "cust_call")}
          </a>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="btn ghost sm">
              {t(lang, "cust_whatsapp")}
            </a>
          )}
        </div>
      </div>

      <div className="admin-tiles cust-tiles">
        <StatTile emphasis label={t(lang, "cust_visits_completed")} value={count(file.completed)} sub={t(lang, "cust_first_since", { d: day(file.firstVisit) })} />
        <StatTile
          label={t(lang, "cust_no_shows")}
          value={count(file.noShows)}
          sub={rate === null ? t(lang, "cust_no_finished") : t(lang, "cust_no_show_rate", { pct: count(rate) })}
          tone={rate !== null && rate >= 20 ? "warn" : null}
        />
        <StatTile label={t(lang, "cust_cancelled")} value={count(file.cancelled)} />
        <StatTile
          label={t(lang, "cust_value")}
          value={formatPrice(file.totalValue, ctx.currency, lang)}
          sub={file.unpriced > 0 ? t(lang, "cust_unpriced", { n: count(file.unpriced) }) : null}
        />
        <StatTile label={t(lang, "cust_last_visit")} value={day(file.lastVisit)} />
        <StatTile label={t(lang, "cust_next_visit")} value={day(file.nextVisit)} />
      </div>

      <CustomerPackages
        lang={lang}
        phone={file.phone}
        packages={file.packages}
        catalogue={file.catalogue}
        isOwner={file.isOwner}
        currency={ctx.currency}
        timezone={ctx.timezone}
      />

      <div className="cust-grid">
        <CustomerTags lang={lang} phone={file.phone} initial={file.tags} />
        <CustomerNotes lang={lang} phone={file.phone} notes={file.notes} timezone={ctx.timezone} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "cust_visits_title")}</p>
        <ul className="cust-visits">
          {file.visits.map((v) => (
            <li key={v.id}>
              <div className="cv-top">
                <span className="cv-when">{when(v.startAt)}</span>
                <span
                  className={`chip ${v.status === "completed" ? "good" : v.status === "no_show" ? "warn" : v.status === "cancelled" ? "bad" : "neutral"}`}
                >
                  {t(lang, statusKey[v.status])}
                </span>
              </div>
              <div className="cv-what">
                {v.service ?? "—"}
                {v.staffId && <> · {staffLabel.get(v.staffId) ?? t(lang, "reports_staff_gone")}</>}
                {v.fromQr && <span className="chip neutral">{t(lang, "cust_from_qr")}</span>}
                {v.packageName && <span className="chip good">{t(lang, "pkg_chip", { name: v.packageName })}</span>}
              </div>
              <VisitPackage lang={lang} phone={file.phone} visit={v} packages={file.packages} />
              {v.notes && <p className="cv-note">{v.notes}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
