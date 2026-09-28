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
        {/* Symbol and Arabic wordmark from the approved brand kit, as two
            images rather than the kit's stacked lockup: its "MAW3ED" line
            would render about 7px tall at header size. Both are at least
            3x their displayed size, so they stay crisp on any phone.
            eslint-disable: fixed-size brand assets gain nothing from the
            image optimiser and must never be deferred. */}
        <Link href="/" className="mh-brand" aria-label={t(lang, "brand")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mh-symbol" src="/brand/symbol-128.png" alt="" width={128} height={128} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="mh-word" src="/brand/wordmark-ar-320.png" alt={t(lang, "brand")} width={320} height={74} />
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
        {/* Desktop only. On a phone five controls in one row squeezed the
            logo into a sliver (owner: "الهيدر مزدحم و شكل اللوجو طالع
            غبي"): the language switch moves into the menu, and the city
            sits beside the greeting on the home page, the one page whose
            lists depend on it (/search has its own city filter). */}
        <div className="mh-desk">
          <CitySelector lang={lang} city={city} />
          <LangToggle lang={lang} />
        </div>
      </div>
    </header>
  );
}
