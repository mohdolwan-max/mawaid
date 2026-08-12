import { notFound } from "next/navigation";
import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { getPublicOrg, listPublicServices } from "@/lib/publicOrg";

export default async function OrgPublicPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const lang = await getLang();

  const org = await getPublicOrg(orgSlug);
  if (!org) notFound();

  const services = await listPublicServices(orgSlug);

  return (
    <div className="public-shell">
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
        </div>
      </div>

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
    </div>
  );
}
