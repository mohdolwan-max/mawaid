import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { facilityCountLabel } from "@/lib/directory";
import { PinIcon } from "@/components/icons";

/** Wddk's "Zones" pattern: geographic browsing one level below the city.
 *  Every tile is a REAL district string typed by some listed org, and
 *  every count is a live query — no curated district list to go stale,
 *  and a district with zero listings simply has no tile. */
export function DistrictTiles({
  lang,
  city,
  rows,
}: {
  lang: Lang;
  city: string;
  rows: { district: string; org_count: number }[];
}) {
  if (rows.length === 0) return null;

  return (
    <section className="card-band">
      <div className="hrow-head">
        <h2>{t(lang, "zones_title")}</h2>
      </div>
      <div className="zone-grid">
        {rows.map((r) => (
          <Link
            key={r.district}
            href={`/search?city=${city}&district=${encodeURIComponent(r.district)}`}
            className="zone-tile"
          >
            <span className="zt-ic">
              <PinIcon size={17} />
            </span>
            <div className="zt-name">{r.district}</div>
            <div className="zt-count">{facilityCountLabel(r.org_count, lang)}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
