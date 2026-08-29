import Link from "next/link";
import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { t } from "@/lib/i18n";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";

// Next.js renders this for any unmatched route, and wherever
// notFound() is called explicitly (e.g. [orgSlug]/page.tsx for a
// slug that doesn't exist) — previously the framework's plain default
// page, with no branding or way back into the app.
export default async function NotFound() {
  const [lang, city] = await Promise.all([getLang(), getCity()]);

  return (
    <div className="market-shell">
      <PublicNav lang={lang} city={city} />
      <div className="empty-state">
        <h1>{t(lang, "not_found_title")}</h1>
        <p>{t(lang, "not_found_sub")}</p>
        <Link href="/" className="btn">
          {t(lang, "back_home")}
        </Link>
      </div>
      <BottomNav lang={lang} />
    </div>
  );
}
