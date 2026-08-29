"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { MenuIcon, SearchIcon, CalendarIcon, UserIcon } from "@/components/icons";

// Hamburger menu — mainly useful on mobile, where header-nav-links is
// hidden (BottomNav covers search/bookings/account there instead) and
// there was previously no way at all to reach /partners, /privacy, or
// /terms except from the footer at the very bottom of the home page.
export function HeaderMenu({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div className="dd-root" ref={rootRef}>
      <button
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t(lang, "menu_label")}
        onClick={() => setOpen((o) => !o)}
      >
        <MenuIcon size={20} />
      </button>
      {open && (
        <ul className="dd-panel menu-panel" role="menu">
          <li role="none">
            <Link href="/search" role="menuitem" onClick={() => setOpen(false)}>
              <SearchIcon size={16} /> {t(lang, "nav_search")}
            </Link>
          </li>
          <li role="none">
            <Link href="/my" role="menuitem" onClick={() => setOpen(false)}>
              <CalendarIcon size={16} /> {t(lang, "nav_my_bookings")}
            </Link>
          </li>
          <li role="none">
            <Link href="/account" role="menuitem" onClick={() => setOpen(false)}>
              <UserIcon size={16} /> {t(lang, "nav_my_account")}
            </Link>
          </li>
          <li className="menu-divider" role="separator" />
          <li role="none">
            <Link href="/partners" role="menuitem" onClick={() => setOpen(false)}>
              {t(lang, "menu_partners")}
            </Link>
          </li>
          <li role="none">
            <Link href="/privacy" role="menuitem" onClick={() => setOpen(false)}>
              {t(lang, "footer_privacy")}
            </Link>
          </li>
          <li role="none">
            <Link href="/terms" role="menuitem" onClick={() => setOpen(false)}>
              {t(lang, "footer_terms")}
            </Link>
          </li>
        </ul>
      )}
    </div>
  );
}
