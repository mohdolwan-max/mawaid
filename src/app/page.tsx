import Link from "next/link";
import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { t } from "@/lib/i18n";
import { cityLabel } from "@/lib/directory";
import { listDirectoryOrgs } from "@/lib/directoryServer";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { CategoryChips } from "@/components/marketplace/CategoryChips";
import { CardRow } from "@/components/marketplace/CardRow";

export default async function MarketplaceHome() {
  const [lang, city] = await Promise.all([getLang(), getCity()]);

  const [featured, inCity, newest] = await Promise.all([
    listDirectoryOrgs({ limit: 12 }),
    listDirectoryOrgs({ city, limit: 12 }),
    listDirectoryOrgs({ limit: 12, offset: 0 }),
  ]);

  const nothingListed = featured.length === 0 && inCity.length === 0;

  return (
    <div className="market-shell">
      <PublicNav lang={lang} city={city} />

      <div className="hero-banner">
        <h1>{t(lang, "market_hero_title")}</h1>
        <p>{t(lang, "market_hero_sub")}</p>
        <SearchBar lang={lang} />
      </div>

      <CategoryChips lang={lang} />

      {nothingListed ? (
        <div className="empty">{t(lang, "market_empty")}</div>
      ) : (
        <>
          <CardRow title={t(lang, "sec_featured")} seeAllHref="/search" orgs={featured} lang={lang} />
          <CardRow
            title={t(lang, "sec_in_city", { city: cityLabel(city, lang) })}
            seeAllHref={`/search?city=${city}`}
            orgs={inCity}
            lang={lang}
          />
          <CardRow title={t(lang, "sec_new")} seeAllHref="/search" orgs={newest} lang={lang} />
        </>
      )}

      <footer style={{ marginTop: 30, paddingTop: 16, borderTop: "1px solid var(--line)", textAlign: "center" }}>
        <Link href="/partners" className="mh-link">
          {t(lang, "partners_link")}
        </Link>
      </footer>

      <BottomNav lang={lang} />
    </div>
  );
}
