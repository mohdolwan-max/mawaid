"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Lang } from "@/lib/i18n";
import { CITIES } from "@/lib/directory";
import { marketName, type Market } from "@/lib/markets";
import { setCityAction } from "./actions";
import { ChevronDownIcon, PinIcon } from "@/components/icons";

// A native <select>'s open dropdown panel is rendered by the OS/browser,
// not by us — it can't be given rounded corners, our brand colors, or a
// selected-row highlight that matches the rest of the UI. A custom
// listbox gives full control over that popup's appearance.
// "inline" is the phone placement beside the greeting, where the header
// has no room for it; the pin makes it read as "your city", not as a
// stray button.
export function CitySelector({
  lang,
  city,
  markets,
  variant = "header",
}: {
  lang: Lang;
  city: string;
  /** Every country (0056); only those shown to customers are offered. */
  markets: Market[];
  variant?: "header" | "inline";
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
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

  const current = CITIES.find((c) => c.key === city);
  const shown = markets.filter((m) => m.listed);

  function pick(next: string) {
    setOpen(false);
    if (next === city) return;
    startTransition(async () => {
      await setCityAction(next);
      router.refresh();
    });
  }

  return (
    <div className={variant === "inline" ? "dd-root city-inline" : "dd-root"} ref={rootRef}>
      <button
        type="button"
        className="mh-link dd-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {variant === "inline" && <PinIcon size={14} />}
        {current ? current[lang] : city}
        <ChevronDownIcon size={14} className="dd-chevron" />
      </button>
      {open && (
        <ul className="dd-panel" role="listbox" aria-label={lang === "ar" ? "المدينة" : "City"}>
          {shown.map((m) => (
            <Fragment key={m.code}>
              {/* A country heading only once there is more than one. */}
              {shown.length > 1 && (
                <li role="presentation" className="dd-group">
                  {marketName(m, lang)}
                </li>
              )}
              {CITIES.filter((c) => c.country === m.code).map((c) => (
                <li
                  key={c.key}
                  role="option"
                  aria-selected={c.key === city}
                  className={c.key === city ? "dd-option on" : "dd-option"}
                  onClick={() => pick(c.key)}
                >
                  {c[lang]}
                </li>
              ))}
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
