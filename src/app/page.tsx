import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { t } from "@/lib/i18n";
import { cityLabel, FEATURED_CATEGORIES } from "@/lib/directory";
import {
  listDirectoryOrgs,
  listNearbyOrgs,
  listDistrictCounts,
  countOpenNow,
} from "@/lib/directoryServer";
import { getGeo } from "@/lib/location";
import { NearMeBar } from "@/components/marketplace/NearMeBar";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { CategoryChips } from "@/components/marketplace/CategoryChips";
import { CardRow } from "@/components/marketplace/CardRow";
import { DistrictTiles } from "@/components/marketplace/DistrictTiles";
import { PublicFooter } from "@/components/marketplace/PublicFooter";

export default async function MarketplaceHome() {
  const [lang, city, geo] = await Promise.all([getLang(), getCity(), getGeo()]);

  // Section rhythm follows the Wddk study (owner's playbook): context →
  // search → browse intents → top-rated → zones → nearest → everything.
  // Every ordering is honest and every number is computed — no blended
  // score, because a ranking nobody can explain reads as rigged:
  //   * top-rated — the existing rating order
  //   * zones     — real district strings with live counts (0036)
  //   * nearest   — pure distance, only when the customer shared a position
  //   * all       — every listed org, newest signup first, so a clinic
  //     with no reviews yet is visible from day one
  const [topRated, allNewest, nearby, districts, openNow] = await Promise.all([
    listDirectoryOrgs({
      city,
      limit: 12,
      featuredCategories: FEATURED_CATEGORIES,
      featuredOnly: true,
    }),
    listDirectoryOrgs({ city, limit: 12, order: "newest" }),
    geo ? listNearbyOrgs(geo.lat, geo.lng, 12) : Promise.resolve([]),
    listDistrictCounts(city),
    countOpenNow(city),
  ]);

  const nothingListed = topRated.length === 0 && allNewest.length === 0;
  const cityName = cityLabel(city, lang);

  return (
    <div className="market-shell">
      <PublicNav lang={lang} city={city} />

      <div className="greeting-row">
        <p className="market-greeting">{t(lang, "market_greeting")}</p>
        {/* The playbook's "context header" — its weather idea replaced by
            something a patient actually uses. Hidden when null (query
            failed / 0036 unapplied) AND when 0: "open now: 0" at 3am is
            true but sells nothing — this chip is invitation, not data. */}
        {openNow != null && openNow > 0 && (
          <span className="open-now-chip">{t(lang, "open_now_count", { n: openNow })}</span>
        )}
      </div>

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

          <DistrictTiles lang={lang} city={city} rows={districts} />

          <NearMeBar lang={lang} hasGeo={geo !== null} hasResults={nearby.length > 0} />
          {nearby.length > 0 && (
            <CardRow title={t(lang, "near_title")} orgs={nearby} lang={lang} />
          )}

          {/* seeAllHref is honest here even though /search sorts by
              rating: this row's claim is a SET ("all clinics"), not an
              ordering, and the destination shows the same set. */}
          <CardRow
            title={t(lang, "sec_all", { city: cityName })}
            seeAllHref={`/search?city=${city}`}
            orgs={allNewest}
            lang={lang}
          />
        </>
      )}

      <PublicFooter lang={lang} />

      <BottomNav lang={lang} />
    </div>
  );
}
