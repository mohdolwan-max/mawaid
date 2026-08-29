import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

// The original pre-marketplace landing card — now the partners/business
// entry point, linked from the marketplace footer.
export default async function PartnersPage() {
  const lang = await getLang();

  return (
    <div className="center-shell">
      <div className="auth-card" style={{ maxWidth: 480, textAlign: "center" }}>
        <h1 style={{ fontSize: 30, color: "var(--brand)", fontWeight: 800 }}>{t(lang, "brand")}</h1>
        <p className="sub" style={{ margin: "8px 0 18px" }}>{t(lang, "landing_sub")}</p>
        <Link href="/signup" className="btn block">
          {t(lang, "landing_cta")}
        </Link>
        <p className="hint" style={{ marginTop: 14 }}>
          <Link href="/login">{t(lang, "login_title")}</Link>
        </p>
        <div className="toolbar" style={{ justifyContent: "center", marginTop: 10 }}>
          <Link href="/privacy" className="hint" style={{ textDecoration: "none" }}>
            {t(lang, "footer_privacy")}
          </Link>
          <span className="hint">·</span>
          <Link href="/terms" className="hint" style={{ textDecoration: "none" }}>
            {t(lang, "footer_terms")}
          </Link>
        </div>
      </div>
    </div>
  );
}
