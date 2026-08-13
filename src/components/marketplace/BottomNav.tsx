"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type Lang } from "@/lib/i18n";

// Public-surface only — never rendered inside the (app) owner layout.
// حجوزاتي (/my) and حسابي (/account) tabs land with customer accounts in
// Phase B.
const TABS = [
  { href: "/", key: "nav_home" as const, icon: "🏠" },
  { href: "/search", key: "nav_search" as const, icon: "🔍" },
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
          <span className="bn-icon">{tab.icon}</span>
          {t(lang, tab.key)}
        </Link>
      ))}
    </nav>
  );
}
