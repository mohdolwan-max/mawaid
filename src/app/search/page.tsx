import Link from "next/link";
import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { t } from "@/lib/i18n";
import { CATEGORIES, CITIES } from "@/lib/directory";
import { listDirectoryOrgs } from "@/lib/directoryServer";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { OrgCard } from "@/components/marketplace/OrgCard";
import { PublicFooter } from "@/components/marketplace/PublicFooter";

const PAGE_SIZE = 24;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; city?: string; category?: string; offset?: string }>;
}) {
  const params = await searchParams;
  const [lang, cookieCity] = await Promise.all([getLang(), getCity()]);

  const q = params.q?.trim() || null;
  const city = CITIES.some((c) => c.key === params.city) ? params.city! : null;
  const category = CATEGORIES.some((c) => c.key === params.category) ? params.category! : null;
  const offset = Math.max(0, Number(params.offset) || 0);

  const orgs = await listDirectoryOrgs({
    city,
    category,
    search: q,
    limit: PAGE_SIZE + 1, // +1 to know whether a next page exists
    offset,
  });
  const hasMore = orgs.length > PAGE_SIZE;
  const visible = hasMore ? orgs.slice(0, PAGE_SIZE) : orgs;

  const buildQuery = (over: Record<string, string | null>) => {
    const merged: Record<string, string | null> = { q, city, category, ...over };
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
          {CITIES.map((c) => (
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
        <button type="submit" className="btn">
          {t(lang, "nav_search")}
        </button>
      </form>

      {visible.length === 0 ? (
        <div className="empty">{t(lang, "search_empty")}</div>
      ) : (
        <div className="search-grid">
          {visible.map((org) => (
            <OrgCard key={org.org_id} org={org} lang={lang} />
          ))}
        </div>
      )}

      {hasMore && (
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
