import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { CitySelector } from "./CitySelector";
import { LangToggle } from "./LangToggle";

// The bottom tab bar (BottomNav) covers /search, /my, /account, but it
// only renders under 700px — above that there was no way at all to
// reach those pages except by typing the URL. header-nav-links fills
// that gap (hidden under 700px via CSS, same breakpoint BottomNav
// appears at, so the two never show at once).
export function PublicNav({ lang, city }: { lang: Lang; city: string }) {
  return (
    <header className="market-header">
      <Link href="/" className="mh-brand">
        {t(lang, "brand")}
      </Link>
      <nav className="header-nav-links">
        <Link href="/search">🔍 {t(lang, "nav_search")}</Link>
        <Link href="/my">📅 {t(lang, "nav_my_bookings")}</Link>
        <Link href="/account">👤 {t(lang, "nav_my_account")}</Link>
      </nav>
      <div className="mh-side">
        <CitySelector lang={lang} city={city} />
        <LangToggle lang={lang} />
      </div>
    </header>
  );
}
