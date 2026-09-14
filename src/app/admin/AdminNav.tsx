"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";

const LINKS: { href: string; key: TKey }[] = [
  { href: "/admin", key: "admin_nav_overview" },
  { href: "/admin/subscriptions", key: "admin_nav_subscriptions" },
  { href: "/admin/sales", key: "admin_nav_sales" },
];

export function AdminNav({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  return (
    <nav className="admin-nav">
      {LINKS.map((l) => {
        const active = l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            {t(lang, l.key)}
          </Link>
        );
      })}
    </nav>
  );
}
