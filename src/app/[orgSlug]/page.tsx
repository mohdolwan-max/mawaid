import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { getPublicOrg, listPublicServices } from "@/lib/publicOrg";
import { getOrgReviews, getOrgRatingSummary } from "@/lib/reviews";
import { categoryLabel, cityLabel, priceTierLabel } from "@/lib/directory";
import { isSafeHttpUrl } from "@/lib/url";
import { PinIcon } from "@/components/icons";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { BackBar } from "@/components/marketplace/BackBar";
import { intlLocale } from "@/lib/date";

// Every page previously shared the root layout's static title/description,
// so sharing a clinic's link on WhatsApp (a primary growth channel for
// this kind of local-business app) showed the generic app name/blurb
// instead of that clinic's own name and photo.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}): Promise<Metadata> {
  const { orgSlug } = await params;
  const org = await getPublicOrg(orgSlug);
  if (!org) return {};

  const lang = await getLang();
  const title = `${org.name} | ${t(lang, "brand")}`;
  const description = org.description || t(lang, "market_hero_sub");
  const image = org.cover_image_url || org.logo_url;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function OrgPublicPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const lang = await getLang();

  const org = await getPublicOrg(orgSlug);
  if (!org) notFound();

  const [services, reviews, ratingSummary] = await Promise.all([
    listPublicServices(orgSlug),
    getOrgReviews(orgSlug),
    getOrgRatingSummary(orgSlug),
  ]);
  const category = categoryLabel(org.category, lang);
  const location = [org.district, cityLabel(org.city, lang)].filter(Boolean).join(" · ");
  const tier = priceTierLabel(org.price_tier);
  // Defense in depth: saveOrgProfile already rejects non-http(s) schemes
  // before this ever reaches the database, but this is rendered as a
  // real <a href> for anonymous visitors, so re-check here too.
  const mapsUrl = org.maps_url && isSafeHttpUrl(org.maps_url) ? org.maps_url : null;

  return (
    <div className="public-shell">
      <BackBar href="/" title="" />
      {org.cover_image_url && (
        <div style={{ margin: "0 0 14px", borderRadius: 14, overflow: "hidden", height: 170 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL */}
          <img
            src={org.cover_image_url}
            alt={org.name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
      )}

      <div className="public-header">
        {org.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- external Supabase Storage URL, no fixed domain to allowlist
          <img src={org.logo_url} alt={org.name} width={56} height={56} style={{ borderRadius: "50%" }} />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--tint)" }} />
        )}
        <div>
          <h1>{org.name}</h1>
          {(org.address || mapsUrl) && (
            <p className="org-address">
              {org.address}
              {mapsUrl && (
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="directions-link">
                  <PinIcon size={14} /> {t(lang, "get_directions")}
                </a>
              )}
            </p>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
            {ratingSummary.avg_rating != null && (
              <span className="rating-badge">
                ★ {Number(ratingSummary.avg_rating).toFixed(1)} ·{" "}
                {t(lang, "reviews_count", { n: ratingSummary.review_count })}
              </span>
            )}
            {category && <span className="chip neutral">{category}</span>}
            {location && <span className="chip neutral">{location}</span>}
            {tier && <span className="price-tier">{tier}</span>}
          </div>
        </div>
      </div>

      {org.description && (
        <div className="card">
          <p style={{ fontSize: 13, color: "var(--ink2)", whiteSpace: "pre-wrap" }}>{org.description}</p>
        </div>
      )}

      <div className="card">
        {services.length === 0 ? (
          <div className="empty">{t(lang, "service_empty")}</div>
        ) : (
          services.map((s) => (
            <div key={s.id} className="service-row" style={{ cursor: "default" }}>
              <div className="service-row-photo">
                {s.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL
                  <img src={s.photo_url} alt="" />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <strong>{s.name}</strong>
                <p className="hint">
                  {s.duration_minutes} {t(lang, "minutes")}
                </p>
              </div>
              {s.price != null && <span className="num">{s.price} {t(lang, "currency")}</span>}
            </div>
          ))
        )}
      </div>

      <Link href={`/${orgSlug}/book`} className="btn block">
        {t(lang, "book_now")}
      </Link>

      {reviews.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ fontWeight: 700, marginBottom: 6 }}>{t(lang, "reviews_title")}</p>
          {reviews.map((r, i) => (
            <div key={i} className="review-row">
              <div className="rv-head">
                <span className="rv-name">{r.customer_name}</span>
                <span className="stars readonly" aria-label={`${r.rating}/5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={n <= r.rating ? "" : "off"}>
                      ★
                    </span>
                  ))}
                </span>
              </div>
              {r.comment && <p>{r.comment}</p>}
              <span className="rv-date">
                {new Date(r.created_at).toLocaleDateString(intlLocale(lang), {
                  dateStyle: "medium",
                })}
              </span>
            </div>
          ))}
        </div>
      )}

      <BottomNav lang={lang} />
    </div>
  );
}
