"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { t, type Lang } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { toggleLang, switchOrgAction } from "./actions";
import type { MyOrg } from "@/lib/branches";

const LINKS = [
  { href: "/dashboard", key: "nav_dashboard" as const },
  { href: "/calendar", key: "nav_calendar" as const },
  { href: "/reports", key: "nav_reports" as const },
  { href: "/services", key: "nav_services" as const },
  { href: "/offers", key: "nav_offers" as const },
  { href: "/billing", key: "nav_billing" as const },
  { href: "/staff", key: "nav_staff" as const },
  { href: "/bookings", key: "nav_bookings" as const },
  { href: "/customers", key: "nav_customers" as const },
  { href: "/waitlist", key: "nav_waitlist" as const },
  { href: "/reviews", key: "reviews_title" as const },
  { href: "/settings", key: "nav_settings" as const },
  { href: "/help", key: "nav_help" as const },
];

export function Sidebar({
  lang,
  orgName,
  unread,
  orgs = [],
  activeOrgId,
}: {
  lang: Lang;
  orgName: string;
  /** Every clinic the user belongs to (0071); a switcher when more than one. */
  orgs?: MyOrg[];
  activeOrgId?: string;
  /** null = the count could not be read. Deliberately not 0: an owner
   *  must never be shown "nothing new" because a query failed. */
  unread: number | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <aside className="sidebar">
      <div className="brand">
        <h1>{orgName}</h1>
        {orgs.length > 1 && (
          <select
            className="org-switch"
            aria-label={t(lang, "branch_switch")}
            value={activeOrgId}
            onChange={(e) => {
              const id = e.target.value;
              startTransition(async () => {
                const r = await switchOrgAction(id);
                // Every page of the dashboard belongs to one clinic: start
                // the new one from its home rather than mid-page.
                if (r.ok) router.push("/dashboard");
                router.refresh();
              });
            }}
          >
            {orgs.map((o) => (
              <option key={o.orgId} value={o.orgId}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        {/* The same symbol and wordmark the public header uses, smaller. */}
        <div className="brand-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/symbol-128.png" alt="" width={22} height={22} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wordmark-ar-teal.png" alt={t(lang, "brand")} width={59} height={14} />
        </div>
      </div>
      <nav className="nav">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={pathname.startsWith(link.href) ? "active" : ""}
          >
            {t(lang, link.key)}
            {link.href === "/dashboard" && unread !== null && unread > 0 && (
              <span className="nav-badge">{unread.toLocaleString(intlLocale(lang))}</span>
            )}
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
