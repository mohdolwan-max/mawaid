import Link from "next/link";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";

export default async function Home() {
  const lang = await getLang();

  return (
    <div className="center-shell">
      <div className="auth-card" style={{ maxWidth: 480, textAlign: "center" }}>
        <h1 style={{ fontSize: 30 }}>{t(lang, "brand")}</h1>
        <p className="sub">{t(lang, "landing_sub")}</p>
        <Link href="/signup" className="btn block">
          {t(lang, "landing_cta")}
        </Link>
      </div>
    </div>
  );
}
