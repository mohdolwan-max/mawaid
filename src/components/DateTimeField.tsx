"use client";

import { useEffect, useRef, useState } from "react";
import { type Lang } from "@/lib/i18n";

// Replacements for <input type="date"> and <input type="datetime-local">.
// Those render their calendar popup in the browser/OS layer, so it can
// never take the app's rounded corners or brand colours — the same
// reason the city <select> was replaced by a custom listbox.
//
// Values stay in the plain formats the callers already use: "YYYY-MM-DD"
// for dates and "HH:mm" (24h) for times, so nothing downstream changes.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Deliberately NOT toISOString(): that converts to UTC first, which
// shifts the calendar day for anyone east or west of Greenwich — in
// Amman (UTC+3) it would hand back yesterday for any time before 03:00.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, close]);
  return ref;
}

export function DateField({
  lang,
  value,
  onChange,
  min,
  placeholder,
}: {
  lang: Lang;
  value: string;
  onChange: (next: string) => void;
  /** "YYYY-MM-DD"; earlier days render disabled. */
  min?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useDismiss(open, () => setOpen(false));

  const selected = parseYmd(value);
  const today = new Date();
  const [view, setView] = useState(() => selected ?? today);
  const locale = lang === "ar" ? "ar-JO" : "en-US";

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const minDate = min ? parseYmd(min) : null;

  // Sunday-first, matching how business_hours keys days ("0" = Sunday)
  // everywhere else in this app.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow" }).format(new Date(2024, 8, 1 + i))
  );

  const label = selected
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(selected)
    : (placeholder ?? "—");

  function pick(day: number) {
    onChange(ymd(new Date(year, month, day)));
    setOpen(false);
  }

  return (
    <div className="dd-root" ref={root}>
      <button
        type="button"
        className="mh-link dd-trigger field-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div className="dd-panel cal-panel" role="dialog">
          <div className="cal-head">
            <button type="button" className="cal-nav" onClick={() => setView(new Date(year, month - 1, 1))} aria-label="Previous month">‹</button>
            <span className="cal-title">
              {new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(view)}
            </span>
            <button type="button" className="cal-nav" onClick={() => setView(new Date(year, month + 1, 1))} aria-label="Next month">›</button>
          </div>
          <div className="cal-grid cal-weekdays">
            {weekdays.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
          <div className="cal-grid">
            {Array.from({ length: firstWeekday }, (_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const d = new Date(year, month, day);
              const disabled = minDate ? d < minDate : false;
              const isSelected = selected != null && ymd(selected) === ymd(d);
              const isToday = ymd(today) === ymd(d);
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  className={`cal-day${isSelected ? " on" : ""}${isToday && !isSelected ? " today" : ""}`}
                  onClick={() => pick(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function TimeField({
  lang,
  value,
  onChange,
  stepMinutes = 15,
  placeholder,
}: {
  lang: Lang;
  value: string;
  onChange: (next: string) => void;
  stepMinutes?: number;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useDismiss(open, () => setOpen(false));
  const locale = lang === "ar" ? "ar-JO" : "en-US";

  const fmt = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(
      new Date(2024, 0, 1, h, m)
    );
  };

  const options: string[] = [];
  for (let mins = 0; mins < 24 * 60; mins += stepMinutes) {
    options.push(`${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);
  }

  return (
    <div className="dd-root" ref={root}>
      <button
        type="button"
        className="mh-link dd-trigger field-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {value ? fmt(value) : (placeholder ?? "—")}
      </button>
      {open && (
        <ul className="dd-panel time-panel" role="listbox">
          {options.map((o) => (
            <li
              key={o}
              role="option"
              aria-selected={o === value}
              className={o === value ? "dd-option on" : "dd-option"}
              onClick={() => {
                onChange(o);
                setOpen(false);
              }}
            >
              {fmt(o)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
