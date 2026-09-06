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
        {/* The real lockup — the designed Arabic wordmark from the brand
            artwork beside a full-size mark — not a small icon next to
            font-rendered text, which read as an afterthought at this
            size (owner: "اللوجو صغير و غبي شكله"). Built at 4x into
            /public/brand-lockup.png so it stays crisp on any phone.
            eslint-disable: a fixed-size brand asset gains nothing from
            the image optimiser and must never be deferred. */}
        <Link href="/" className="mh-brand" aria-label={t(lang, "brand")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand-lockup.png" alt={t(lang, "brand")} width={537} height={136} />
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
