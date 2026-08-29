"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Lang } from "@/lib/i18n";
import { CITIES } from "@/lib/directory";
import { setCityAction } from "./actions";

// A native <select>'s open dropdown panel is rendered by the OS/browser,
// not by us — it can't be given rounded corners, our brand colors, or a
// selected-row highlight that matches the rest of the UI. A custom
// listbox gives full control over that popup's appearance.
export function CitySelector({ lang, city }: { lang: Lang; city: string }) {
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

  function pick(next: string) {
    setOpen(false);
    if (next === city) return;
    startTransition(async () => {
      await setCityAction(next);
      router.refresh();
    });
  }

  return (
    <div className="dd-root" ref={rootRef}>
      <button
        type="button"
        className="mh-link dd-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {current ? current[lang] : city}
        <span className="dd-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <ul className="dd-panel" role="listbox" aria-label={lang === "ar" ? "المدينة" : "City"}>
          {CITIES.map((c) => (
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
        </ul>
      )}
    </div>
  );
}
