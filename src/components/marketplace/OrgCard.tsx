import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { categoryLabel, cityLabel, priceTierLabel, type DirectoryOrg } from "@/lib/directory";

export function OrgCard({ org, lang }: { org: DirectoryOrg; lang: Lang }) {
  const meta = [org.district, cityLabel(org.city, lang)].filter(Boolean).join(" · ");
  const category = categoryLabel(org.category, lang);
  const tier = priceTierLabel(org.price_tier);

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
      </div>
      <div className="oc-body">
        <div className="oc-name">{org.name}</div>
        {meta && <div className="oc-meta">{meta}</div>}
        <div className="oc-foot">
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {category && <span className="chip neutral">{category}</span>}
            {tier && <span className="price-tier">{tier}</span>}
          </span>
          {org.avg_rating != null && (
            <span className="rating-badge">★ {Number(org.avg_rating).toFixed(1)}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
