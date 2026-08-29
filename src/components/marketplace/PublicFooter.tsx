import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { currentYear } from "@/lib/date";

export function PublicFooter({ lang }: { lang: Lang }) {
  return (
    <footer style={{ marginTop: 30, paddingTop: 16, borderTop: "1px solid var(--line)", textAlign: "center" }}>
      <Link href="/partners" className="mh-link">
        {t(lang, "partners_link")}
      </Link>
      <div className="toolbar" style={{ justifyContent: "center", marginTop: 14 }}>
        <Link href="/privacy" className="hint" style={{ textDecoration: "none" }}>
          {t(lang, "footer_privacy")}
        </Link>
        <span className="hint">·</span>
        <Link href="/terms" className="hint" style={{ textDecoration: "none" }}>
          {t(lang, "footer_terms")}
        </Link>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>{t(lang, "footer_rights", { year: currentYear() })}</p>
    </footer>
  );
}
