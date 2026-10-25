import Link from "next/link";
import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import { canonicalSiteUrl } from "@/lib/siteUrl";
import { clinicShareUrl } from "@/lib/share";
import { GUIDE, supportWhatsappUrl } from "@/lib/guide";

// Help (roadmap item 14): reaching the platform's support, and a short
// guide to every part of the dashboard, each section opening its page.
export default async function HelpPage() {
  const ctx = await requireOrgContext();
  const lang = ctx.lang;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("support_contact");
  // Before 0074 (PGRST202) or on a failure the email still works: it is
  // the platform's real inbox, written here as the fallback.
  if (error && error.code !== "PGRST202") console.error("support_contact failed", error);
  const contact = (error ? null : data) as { whatsapp?: string | null; email?: string | null } | null;
  const email = contact?.email ?? "support@maw3ed.me";
  const message = t(lang, "help_wa_message", { name: ctx.name, link: clinicShareUrl(canonicalSiteUrl(), ctx.slug) });
  const wa = supportWhatsappUrl(contact?.whatsapp ?? null, message);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{t(lang, "help_title")}</h2>
          <p className="sub">{t(lang, "help_sub")}</p>
        </div>
      </div>

      <div className="card">
        <p style={{ fontWeight: 700, marginBottom: 4 }}>{t(lang, "help_contact_title")}</p>
        <p className="hint" style={{ marginBottom: 10 }}>{t(lang, "help_contact_sub")}</p>
        <div className="toolbar">
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="btn">
              {t(lang, "help_whatsapp")}
            </a>
          )}
          <a href={`mailto:${email}`} className={wa ? "btn ghost" : "btn"}>
            {t(lang, "help_email", { email })}
          </a>
        </div>
      </div>

      <p style={{ fontWeight: 700, margin: "18px 0 8px" }}>{t(lang, "help_guide_title")}</p>
      {GUIDE.map((s) => (
        <details key={s.id} className="card links-card help-section" style={{ marginBottom: 8 }}>
          <summary>
            <span className="links-card-title">{s.title[lang]}</span>
          </summary>
          <ul className="help-points">
            {s.points[lang].map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
          <Link href={s.href} className="btn ghost sm">
            {t(lang, "help_open_page")}
          </Link>
        </details>
      ))}
    </div>
  );
}
