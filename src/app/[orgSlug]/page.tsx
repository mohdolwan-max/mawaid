import { notFound } from "next/navigation";
import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { getPublicOrg, listPublicServices } from "@/lib/publicOrg";
import { categoryLabel, cityLabel, priceTierLabel } from "@/lib/directory";
import { BottomNav } from "@/components/marketplace/BottomNav";

export default async function OrgPublicPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const lang = await getLang();

  const org = await getPublicOrg(orgSlug);
  if (!org) notFound();

  const services = await listPublicServices(orgSlug);
  const category = categoryLabel(org.category, lang);
  const location = [org.district, cityLabel(org.city, lang)].filter(Boolean).join(" · ");
  const tier = priceTierLabel(org.price_tier);

  return (
    <div className="public-shell">
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
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
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

      <BottomNav lang={lang} />
    </div>
  );
}
