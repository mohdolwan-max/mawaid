"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type Lang } from "@/lib/i18n";
import { HomeIcon, SearchIcon, CalendarIcon, UserIcon } from "@/components/icons";

// Public-surface only — never rendered inside the (app) owner layout.
const TABS = [
  { href: "/", key: "nav_home" as const, Icon: HomeIcon },
  { href: "/search", key: "nav_search" as const, Icon: SearchIcon },
  { href: "/my", key: "nav_my_bookings" as const, Icon: CalendarIcon },
  { href: "/account", key: "nav_my_account" as const, Icon: UserIcon },
];

export function BottomNav({ lang }: { lang: Lang }) {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={
            tab.href === "/" ? (pathname === "/" ? "active" : "") : pathname.startsWith(tab.href) ? "active" : ""
          }
        >
          <span className="bn-icon">
            <tab.Icon size={20} />
          </span>
          {t(lang, tab.key)}
        </Link>
      ))}
    </nav>
  );
}
