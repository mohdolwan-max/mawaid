import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import type { DirectoryOrg } from "@/lib/directory";
import { OrgCard } from "./OrgCard";

// The vertical counterpart of CardRow — a feed that grows DOWN in
// wrapping rows (owner: "بدل ما نروح يسار افتح لتحت... كأنه فيسبوك أو
// انستغرام"). Horizontal rows stay right for the curated shelves
// (top-rated, nearest); the catch-all "every clinic" list reads as a
// feed, and in a one-clinic city a lone card in a scroll row was mostly
// empty track. Reuses .search-grid, so this and the search results page
// are one layout, not two drifting ones.
export function CardGrid({
  title,
  seeAllHref,
  orgs,
  lang,
}: {
  title: string;
  seeAllHref?: string;
  orgs: DirectoryOrg[];
  lang: Lang;
}) {
  if (orgs.length === 0) return null;

  return (
    <section className="card-band">
      <div className="hrow-head">
        <h2>{title}</h2>
        {seeAllHref && <Link href={seeAllHref}>{t(lang, "see_all")}</Link>}
      </div>
      <div className="search-grid" style={{ paddingBottom: 14 }}>
        {orgs.map((org) => (
          <OrgCard key={org.org_id} org={org} lang={lang} />
        ))}
      </div>
    </section>
  );
}
