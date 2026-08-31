"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { t, type Lang } from "@/lib/i18n";
import { toggleLang } from "./actions";

const LINKS = [
  { href: "/dashboard", key: "nav_dashboard" as const },
  { href: "/calendar", key: "nav_calendar" as const },
  { href: "/services", key: "nav_services" as const },
  { href: "/staff", key: "nav_staff" as const },
  { href: "/bookings", key: "nav_bookings" as const },
  { href: "/reviews", key: "reviews_title" as const },
  { href: "/settings", key: "nav_settings" as const },
];

export function Sidebar({ lang, orgName }: { lang: Lang; orgName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <aside className="sidebar">
      <div className="brand">
        <h1>{orgName}</h1>
        <small>{t(lang, "brand")}</small>
      </div>
      <nav className="nav">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={pathname.startsWith(link.href) ? "active" : ""}
          >
            {t(lang, link.key)}
          </Link>
        ))}
      </nav>
      <div className="side-foot">
        <button
          className="lang-btn"
          onClick={() =>
            startTransition(async () => {
              await toggleLang(lang);
              router.refresh();
            })
          }
        >
          {t(lang, "lang_toggle")}
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional full navigation to a Route Handler (GET /auth/signout), not an app route */}
        <a href="/auth/signout" style={{ display: "block", padding: "6px 0", color: "var(--ink2)" }}>
          {t(lang, "signout")}
        </a>
      </div>
    </aside>
  );
}
