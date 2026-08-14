import { notFound } from "next/navigation";
import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { getPublicOrg, listPublicServices } from "@/lib/publicOrg";
import { getOrgReviews, getOrgRatingSummary } from "@/lib/reviews";
import { categoryLabel, cityLabel, priceTierLabel } from "@/lib/directory";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { BackBar } from "@/components/marketplace/BackBar";

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
          {org.address && <p>{org.address}</p>}
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
              <div>
                <strong>{s.name}</strong>
                <p className="hint">
                  {s.duration_minutes} {t(lang, "minutes")}
                </p>
              </div>
              {s.price != null && <span className="num">{s.price} {t(lang, "sar")}</span>}
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
                {new Date(r.created_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
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
