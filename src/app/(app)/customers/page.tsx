import Link from "next/link";
import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { formatPhoneForDisplay } from "@/lib/phone";
import { parseCustomerRows } from "@/lib/customerFile";

const PAGE = 50;

// Everyone who has booked at this clinic, most recent activity first
// (0062). A customer is a phone number: guests have no account, and the
// three ways one number gets typed are one person.
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string }>;
}) {
  const ctx = await requireOrgContext();
  const lang = ctx.lang;
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 60);
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.p ?? "1", 10) || 1));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_org_customers", {
    p_search: q || null,
    p_limit: PAGE,
    p_offset: (page - 1) * PAGE,
  });

  const head = (
    <div className="page-head">
      <div>
        <h2>{t(lang, "customers_title")}</h2>
        <p className="sub">{t(lang, "customers_sub")}</p>
      </div>
      {ctx.role === "owner" && (
        <div className="toolbar">
          <Link href="/customers/import" className="btn ghost sm">
            {t(lang, "import_link")}
          </Link>
        </div>
      )}
    </div>
  );

  // A failed read is an error, never an empty clinic (§1).
  if (error) {
    if (error.code !== "PGRST202") console.error("list_org_customers failed", error);
    return (
      <div>
        {head}
        <div className="card">
          <p className="error-text">{t(lang, "error_generic")}</p>
        </div>
      </div>
    );
  }

  const { rows, total } = parseCustomerRows(data);
  const locale = intlLocale(lang);
  const day = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { timeZone: ctx.timezone, dateStyle: "medium" }).format(new Date(iso)) : "—";
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pageHref = (p: number) => `/customers?${new URLSearchParams({ ...(q ? { q } : {}), p: String(p) }).toString()}`;

  return (
    <div>
      {head}
      <form className="card cust-search" action="/customers" method="get">
        <input name="q" defaultValue={q} placeholder={t(lang, "customers_search_ph")} aria-label={t(lang, "customers_search_ph")} />
        <button type="submit" className="btn">
          {t(lang, "customers_search_btn")}
        </button>
      </form>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">{q ? t(lang, "customers_no_match") : t(lang, "customers_empty")}</div>
        ) : (
          <>
            <p className="hint" style={{ marginBottom: 8 }}>
              {t(lang, "customers_count", { n: total.toLocaleString(locale) })}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t(lang, "customer_name")}</th>
                    <th>{t(lang, "customer_phone")}</th>
                    <th>{t(lang, "cust_visits_completed")}</th>
                    <th>{t(lang, "cust_last_visit")}</th>
                    <th>{t(lang, "cust_next_visit")}</th>
                    <th>{t(lang, "cust_tags_title")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.phone}>
                      <td>
                        <Link href={`/customers/${encodeURIComponent(r.phone)}`} className="cust-link">
                          {r.name}
                        </Link>
                        {r.noShows > 0 && (
                          <span className="chip warn" title={t(lang, "cust_no_shows")}>
                            {t(lang, "cust_no_shows_chip", { n: r.noShows })}
                          </span>
                        )}
                        {r.packages > 0 && (
                          <span className="chip good">{t(lang, "pkg_list_chip", { n: r.packages.toLocaleString(locale) })}</span>
                        )}
                      </td>
                      <td dir="ltr">{formatPhoneForDisplay(r.phone)}</td>
                      <td>{r.completed.toLocaleString(locale)}</td>
                      <td>{day(r.lastVisit)}</td>
                      <td>{day(r.nextVisit)}</td>
                      <td>
                        {r.tags.map((tag) => (
                          <span key={tag} className="chip neutral">
                            {tag}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="toolbar" style={{ justifyContent: "center", marginTop: 12 }}>
                {page > 1 && (
                  <Link href={pageHref(page - 1)} className="btn ghost sm">
                    {t(lang, "page_prev")}
                  </Link>
                )}
                <span className="hint">{t(lang, "page_of", { p: page, n: pages })}</span>
                {page < pages && (
                  <Link href={pageHref(page + 1)} className="btn ghost sm">
                    {t(lang, "page_next")}
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
