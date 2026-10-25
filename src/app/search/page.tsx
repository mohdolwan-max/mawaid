import Link from "next/link";
import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { t, type TKey } from "@/lib/i18n";
import { CATEGORIES, FEATURED_CATEGORIES, citiesOf, countryOfCity } from "@/lib/directory";
import { listDirectoryOrgs, searchOpenTimes } from "@/lib/directoryServer";
import { DAY_OFFSETS, WINDOWS, countryTimezone, openTimeHref, parseOpenTimes, parseWhen, type OpenTimesRow } from "@/lib/openTimes";
import { formatPrice } from "@/lib/billing";
import { intlLocale, addDaysYMD, todayYMD } from "@/lib/date";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { OrgCard } from "@/components/marketplace/OrgCard";
import { PublicFooter } from "@/components/marketplace/PublicFooter";

const PAGE_SIZE = 24;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; city?: string; category?: string; district?: string; offset?: string; day?: string; time?: string }>;
}) {
  const params = await searchParams;
  const [lang, cookieCity] = await Promise.all([getLang(), getCity()]);

  const q = params.q?.trim() || null;
  // Search stays inside the visitor's country (0056): its cities are the
  // choices, and "all cities" means all of that country's.
  const country = countryOfCity(cookieCity);
  const countryCities = country ? citiesOf(country) : [];
  const city = countryCities.some((c) => c.key === params.city) ? params.city! : null;
  const category = CATEGORIES.some((c) => c.key === params.category) ? params.category! : null;
  // District is owner-typed free text (the zone tiles link here with it),
  // so unlike city/category there is no allowlist to check against — the
  // RPC matches it by exact equality, and garbage just finds nothing.
  // Length-capped so a crafted URL can't push kilobytes into the query.
  const district = params.district?.trim().slice(0, 80) || null;
  const offset = Math.max(0, Number(params.offset) || 0);
  // "When?" (0069): with a day chosen, the page lists free times instead
  // of clinics. Unknown values are ignored.
  const tz = countryTimezone(country);
  const when = parseWhen(params, tz);
  let timeRows: OpenTimesRow[] | null = null;
  let timeError = false;
  if (when) {
    try {
      const w = when.window ? WINDOWS[when.window] : null;
      timeRows = parseOpenTimes(
        await searchOpenTimes({
          country,
          city,
          category,
          query: q,
          date: when.date,
          from: w?.from ?? null,
          to: w?.to ?? null,
        })
      );
    } catch {
      // Said as a failure, never as "no free times" (§1).
      timeError = true;
    }
  }
  const locale = intlLocale(lang);
  const today = todayYMD(tz);
  const dayLabel = (n: number) =>
    n === 0
      ? t(lang, "when_today")
      : n === 1
        ? t(lang, "when_tomorrow")
        : new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(
            new Date(`${addDaysYMD(today, n)}T12:00:00Z`)
          );
  const clock = (iso: string) => new Intl.DateTimeFormat(locale, { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  const orgs = when ? [] : await listDirectoryOrgs({
    city,
    category,
    district,
    search: q,
    country,
    limit: PAGE_SIZE + 1, // +1 to know whether a next page exists
    offset,
    // Tiebreaker only (featuredOnly defaults to false) — search stays
    // fully browsable across every category, just nudges featured ones up.
    featuredCategories: FEATURED_CATEGORIES,
  });
  const hasMore = orgs.length > PAGE_SIZE;
  const visible = hasMore ? orgs.slice(0, PAGE_SIZE) : orgs;

  const buildQuery = (over: Record<string, string | null>) => {
    const merged: Record<string, string | null> = { q, city, category, district, day: params.day ?? null, time: params.time ?? null, ...over };
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (v) usp.set(k, v);
    }
    const s = usp.toString();
    return s ? `/search?${s}` : "/search";
  };

  return (
    <div className="market-shell">
      <PublicNav lang={lang} city={cookieCity} />

      <div className="page-head">
        <h2 style={{ color: "var(--brand)", fontSize: 21, fontWeight: 800 }}>{t(lang, "search_title")}</h2>
      </div>

      {/* GET form — server-rendered filtering, no client state */}
      <form action="/search" method="get" className="search-filters">
        <input type="search" name="q" defaultValue={q ?? ""} placeholder={t(lang, "market_search_placeholder")} />
        <select name="city" defaultValue={city ?? ""}>
          <option value="">{t(lang, "filter_all_cities")}</option>
          {countryCities.map((c) => (
            <option key={c.key} value={c.key}>
              {c[lang]}
            </option>
          ))}
        </select>
        <select name="category" defaultValue={category ?? ""}>
          <option value="">{t(lang, "filter_all_categories")}</option>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c[lang]}
            </option>
          ))}
        </select>
        <select name="day" defaultValue={when ? String(when.offset) : ""} aria-label={t(lang, "when_day")}>
          <option value="">{t(lang, "when_any_day")}</option>
          {DAY_OFFSETS.map((n) => (
            <option key={n} value={n}>
              {dayLabel(n)}
            </option>
          ))}
        </select>
        <select name="time" defaultValue={when?.window ?? ""} aria-label={t(lang, "when_time")}>
          <option value="">{t(lang, "when_any_time")}</option>
          {(Object.keys(WINDOWS) as (keyof typeof WINDOWS)[]).map((k) => (
            <option key={k} value={k}>
              {t(lang, `when_${k}` as TKey)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn">
          {t(lang, "nav_search")}
        </button>
      </form>
      {!when && <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>{t(lang, "when_hint")}</p>}

      {/* Arriving from a zone tile filters by district invisibly — this
          chip makes the active filter visible and removable, otherwise
          the page reads as "search is broken, half the clinics vanished". */}
      {district && (
        <div style={{ marginBottom: 12 }}>
          <Link href={buildQuery({ district: null })} className="chip neutral">
            {district} ✕
          </Link>
        </div>
      )}

      {when ? (
        timeError ? (
          <div className="empty">{t(lang, "error_generic")}</div>
        ) : !timeRows || timeRows.length === 0 ? (
          <div className="empty">{t(lang, "when_none")}</div>
        ) : (
          <div className="open-times">
            <p className="hint" style={{ marginBottom: 8 }}>
              {t(lang, "when_results", { day: dayLabel(when.offset) })}
            </p>
            {timeRows.map((row) => (
              <div key={`${row.orgSlug}|${row.serviceId}`} className="card ot-card">
                <div className="cv-top">
                  <Link href={`/${row.orgSlug}`} className="ot-org">
                    {row.orgName}
                  </Link>
                  {row.avgRating !== null && row.reviewCount > 0 && (
                    <span className="hint">★ {row.avgRating.toLocaleString(locale)}</span>
                  )}
                </div>
                <p className="cv-what">
                  {row.serviceName}
                  {row.price !== null && row.price > 0 && <> · {formatPrice(row.price, row.currency, lang)}</>}
                  {row.district && <> · {row.district}</>}
                </p>
                <div className="ot-times">
                  {row.times.map((iso) => (
                    <Link key={iso} href={openTimeHref(row.orgSlug, row.serviceId, when.date, iso)} className="slot-btn">
                      {clock(iso)}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      ) : visible.length === 0 ? (
        <div className="empty">{t(lang, "search_empty")}</div>
      ) : (
        <div className="search-grid">
          {visible.map((org) => (
            <OrgCard key={org.org_id} org={org} lang={lang} />
          ))}
        </div>
      )}

      {!when && hasMore && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <Link href={buildQuery({ offset: String(offset + PAGE_SIZE) })} className="btn ghost">
            {t(lang, "load_more")}
          </Link>
        </div>
      )}

      <PublicFooter lang={lang} />
      <BottomNav lang={lang} />
    </div>
  );
}
