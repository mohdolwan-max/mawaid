import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { SearchIcon, CalendarIcon, UserIcon } from "@/components/icons";
import { CitySelector } from "./CitySelector";
import { LangToggle } from "./LangToggle";
import { HeaderMenu } from "./HeaderMenu";
import { NotificationBell } from "./NotificationBell";

// The bottom tab bar (BottomNav) covers /search, /my, /account, but it
// only renders under 700px — above that there was no way at all to
// reach those pages except by typing the URL. header-nav-links fills
// that gap (hidden under 700px via CSS, same breakpoint BottomNav
// appears at, so the two never show at once).
export function PublicNav({ lang, city }: { lang: Lang; city: string }) {
  return (
    <header className="market-header">
      <div className="mh-start">
        <HeaderMenu lang={lang} />
        <Link href="/" className="mh-brand">
          {t(lang, "brand")}
        </Link>
      </div>
      <nav className="header-nav-links">
        <Link href="/search">
          <SearchIcon size={15} /> {t(lang, "nav_search")}
        </Link>
        <Link href="/my">
          <CalendarIcon size={15} /> {t(lang, "nav_my_bookings")}
        </Link>
        <Link href="/account">
          <UserIcon size={15} /> {t(lang, "nav_my_account")}
        </Link>
      </nav>
      <div className="mh-side">
        <NotificationBell lang={lang} />
        <CitySelector lang={lang} city={city} />
        <LangToggle lang={lang} />
      </div>
    </header>
  );
}
