import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { t } from "@/lib/i18n";
import { cityLabel, FEATURED_CATEGORIES } from "@/lib/directory";
import { listDirectoryOrgs } from "@/lib/directoryServer";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { CategoryChips } from "@/components/marketplace/CategoryChips";
import { CardRow } from "@/components/marketplace/CardRow";
import { PublicFooter } from "@/components/marketplace/PublicFooter";

export default async function MarketplaceHome() {
  const [lang, city] = await Promise.all([getLang(), getCity()]);

  // Every row on this page is scoped to the selected city — the whole
  // point of the city selector is that changing it changes what you see.
  const [topRated, newest] = await Promise.all([
    listDirectoryOrgs({ city, limit: 12, featuredCategories: FEATURED_CATEGORIES, featuredOnly: true }),
    listDirectoryOrgs({ city, limit: 12, offset: 0, featuredCategories: FEATURED_CATEGORIES, featuredOnly: true }),
  ]);

  const nothingListed = topRated.length === 0 && newest.length === 0;
  const cityName = cityLabel(city, lang);

  return (
    <div className="market-shell">
      <PublicNav lang={lang} city={city} />

      <p className="market-greeting">{t(lang, "market_greeting")}</p>

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
          <CardRow
            title={t(lang, "sec_featured", { city: cityName })}
            seeAllHref={`/search?city=${city}`}
            orgs={topRated}
            lang={lang}
          />
          <CardRow
            title={t(lang, "sec_new", { city: cityName })}
            seeAllHref={`/search?city=${city}`}
            orgs={newest}
            lang={lang}
          />
        </>
      )}

      <PublicFooter lang={lang} />

      <BottomNav lang={lang} />
    </div>
  );
}
