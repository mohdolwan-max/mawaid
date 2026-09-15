"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { DateField } from "@/components/DateTimeField";
import {
  MAX_PERIOD_SPAN,
  PERIOD_PRESETS,
  addDays,
  periodDays,
  periodSearch,
  presetRange,
  type Period,
  type PeriodPreset,
} from "@/lib/period";

const PRESET_KEY: Record<PeriodPreset, TKey> = {
  today: "period_today",
  yesterday: "period_yesterday",
  week: "period_week",
  last_week: "period_last_week",
  month: "period_month",
  last_month: "period_last_month",
  last30: "period_last30",
  year: "period_year",
  last_year: "period_last_year",
};

// The period dropdown, as in Mahsoob: presets plus a custom range, all in
// the URL so a report link opens on the same period. A custom listbox
// rather than <select>, for the same reason as CitySelector: the native
// popup cannot take the app's styling.
export function PeriodPicker({
  lang,
  path,
  period,
  today,
  keep = {},
}: {
  lang: Lang;
  path: string;
  period: Period;
  /** "YYYY-MM-DD" in the admin timezone, from the server. */
  today: string;
  /** Other query parameters the page needs kept. */
  keep?: Record<string, string | null>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(period.custom);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCustom(period.custom), [period.custom]);

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

  function go(from: string, to: string, isCustom: boolean) {
    startTransition(() => {
      router.push(`${path}?${periodSearch({ from, to, custom: isCustom }, keep)}`);
    });
  }

  function pickPreset(p: PeriodPreset) {
    setOpen(false);
    setCustom(false);
    const [from, to] = presetRange(p, today);
    go(from, to, false);
  }

  // Moving one end never leaves a reversed or too-long period: the other
  // end follows.
  function pickFrom(from: string) {
    let to = period.to < from ? from : period.to;
    if (periodDays(from, to) - 1 > MAX_PERIOD_SPAN) to = addDays(from, MAX_PERIOD_SPAN);
    go(from, to, true);
  }

  function pickTo(to: string) {
    let from = period.from > to ? to : period.from;
    if (periodDays(from, to) - 1 > MAX_PERIOD_SPAN) from = addDays(to, -MAX_PERIOD_SPAN);
    go(from, to, true);
  }

  const fmt = (ymd: string) =>
    new Intl.DateTimeFormat(intlLocale(lang), { timeZone: "UTC", dateStyle: "medium" }).format(new Date(`${ymd}T00:00:00Z`));
  const label = custom || !period.preset ? t(lang, "period_custom") : t(lang, PRESET_KEY[period.preset]);

  return (
    <div className="period-picker" aria-busy={pending}>
      <span className="period-label">{t(lang, "period_label")}</span>
      <div className="dd-root" ref={rootRef}>
        <button
          type="button"
          className="mh-link dd-trigger field-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {label}
          <span className="dd-chevron" aria-hidden="true">⌄</span>
        </button>
        {open && (
          <ul className="dd-panel" role="listbox" aria-label={t(lang, "period_label")}>
            {PERIOD_PRESETS.map((p) => {
              const on = !custom && period.preset === p;
              return (
                <li key={p} role="option" aria-selected={on} className={on ? "dd-option on" : "dd-option"} onClick={() => pickPreset(p)}>
                  {t(lang, PRESET_KEY[p])}
                </li>
              );
            })}
            <li
              role="option"
              aria-selected={custom}
              className={custom ? "dd-option on" : "dd-option"}
              onClick={() => {
                setOpen(false);
                setCustom(true);
              }}
            >
              {t(lang, "period_custom")}
            </li>
          </ul>
        )}
      </div>
      {custom ? (
        <div className="period-dates">
          <label className="period-date">
            <span>{t(lang, "period_from")}</span>
            <DateField lang={lang} value={period.from} onChange={pickFrom} />
          </label>
          <label className="period-date">
            <span>{t(lang, "period_to")}</span>
            <DateField lang={lang} value={period.to} min={period.from} onChange={pickTo} />
          </label>
        </div>
      ) : (
        <span className="period-range">{t(lang, "period_range", { from: fmt(period.from), to: fmt(period.to) })}</span>
      )}
    </div>
  );
}
