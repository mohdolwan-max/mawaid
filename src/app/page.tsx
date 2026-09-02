import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { t } from "@/lib/i18n";
import { cityLabel, FEATURED_CATEGORIES } from "@/lib/directory";
import { listDirectoryOrgs, listNearbyOrgs } from "@/lib/directoryServer";
import { getGeo } from "@/lib/location";
import { NearMeBar } from "@/components/marketplace/NearMeBar";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { CategoryChips } from "@/components/marketplace/CategoryChips";
import { CardRow } from "@/components/marketplace/CardRow";
import { PublicFooter } from "@/components/marketplace/PublicFooter";

export default async function MarketplaceHome() {
  const [lang, city, geo] = await Promise.all([getLang(), getCity(), getGeo()]);

  // Every row EXCEPT the nearest one is scoped to the selected city —
  // nearest is deliberately unscoped, because physical distance does not
  // care about a browse filter.
  //
  // ONE query, not two. These were two calls with identical arguments
  // (offset: 0 is the default), so the page paid for the same round trip
  // twice and then rendered the same clinics in both rows — the RPC has
  // a single ordering and no way to ask for "newest". Until it can, the
  // second row cannot be honest, so it is not rendered at all rather
  // than repeating the first under a heading that claims otherwise.
  // Two rows, two honest orderings: nearest is pure distance (only when
  // the customer chose to share a position), featured is the existing
  // rating order. No blended score — a ranking nobody can explain reads
  // as a ranking that is rigged.
  const [topRated, nearby] = await Promise.all([
    listDirectoryOrgs({
      city,
      limit: 12,
      featuredCategories: FEATURED_CATEGORIES,
      featuredOnly: true,
    }),
    geo ? listNearbyOrgs(geo.lat, geo.lng, 12) : Promise.resolve([]),
  ]);

  const nothingListed = topRated.length === 0;
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

      <NearMeBar lang={lang} hasGeo={geo !== null} hasResults={nearby.length > 0} />

      {nearby.length > 0 && (
        <CardRow title={t(lang, "near_title")} orgs={nearby} lang={lang} />
      )}

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
        </>
      )}

      <PublicFooter lang={lang} />

      <BottomNav lang={lang} />
    </div>
  );
}
