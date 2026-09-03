import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { categoryLabel, cityLabel, distanceLabel, priceTierLabel, type DirectoryOrg } from "@/lib/directory";
import { PinIcon } from "@/components/icons";

export function OrgCard({ org, lang }: { org: DirectoryOrg; lang: Lang }) {
  // distanceLabel returns "" when distance_km is absent, so cards from
  // the ordinary listings render exactly as before — no distance, not 0.
  const meta = [org.district, cityLabel(org.city, lang), distanceLabel(org.distance_km, lang)]
    .filter(Boolean)
    .join(" · ");
  const category = categoryLabel(org.category, lang);
  const tier = priceTierLabel(org.price_tier, lang);
  // No line unless there is a real PAID price: missing field (pre-0036),
  // no priced services, or a database still counting free consultations
  // into the minimum (pre-0037) all hide it — "from 0 JOD" reads as
  // broken data, never as a gift.
  const fromPrice = org.min_price != null && Number(org.min_price) > 0 ? Number(org.min_price) : null;

  return (
    <Link href={`/${org.slug}`} className="org-card">
      <div className="oc-cover">
        {org.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL, unoptimized by design
          <img className="cover" src={org.cover_image_url} alt={org.name} />
        ) : org.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="logo-fallback" src={org.logo_url} alt={org.name} />
        ) : null}
        {/* Rating overlays the photo (Wddk-style card density) instead of
            spending a body row on it. Absent rating = no badge, not 0. */}
        {org.avg_rating != null && (
          <span className="oc-rate">★ {Number(org.avg_rating).toFixed(1)}</span>
        )}
      </div>
      <div className="oc-body">
        <div className="oc-name">{org.name}</div>
        {meta && (
          <div className="oc-meta">
            <PinIcon size={11} /> {meta}
          </div>
        )}
        <div className="oc-foot">
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            {category && <span className="chip neutral">{category}</span>}
            {tier && <span className="price-tier">{tier}</span>}
          </span>
          {fromPrice != null && (
            <span className="oc-price">
              {t(lang, "card_from")} {fromPrice} {t(lang, "currency")}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
