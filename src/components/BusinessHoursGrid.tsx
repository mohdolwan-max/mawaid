"use client";

import { t, type Lang } from "@/lib/i18n";
import type { BusinessHours } from "@/lib/types";

// Shared day-by-day open/close/closed editor — used by org-wide business
// hours (Settings) and per-staff schedules (Staff), same jsonb shape
// keyed "0".."6" (Sunday..Saturday).
const DAY_KEYS = ["day_sun", "day_mon", "day_tue", "day_wed", "day_thu", "day_fri", "day_sat"] as const;

export function BusinessHoursGrid({
  lang,
  hours,
  onChange,
  disabled,
}: {
  lang: Lang;
  hours: BusinessHours;
  onChange: (next: BusinessHours) => void;
  disabled?: boolean;
}) {
  return (
    <>
      {DAY_KEYS.map((dayKey, idx) => {
        const key = String(idx);
        const day = hours[key];
        if (!day) return null;
        return (
          <div key={key} className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 90, fontSize: 12.5, fontWeight: 600 }}>{t(lang, dayKey)}</span>
            <label style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 0 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                disabled={disabled}
                checked={!day.closed}
                onChange={(e) => onChange({ ...hours, [key]: { ...day, closed: !e.target.checked } })}
              />
              {t(lang, "open")}
            </label>
            {!day.closed && (
              <>
                <input
                  type="time"
                  dir="ltr"
                  disabled={disabled}
                  value={day.open}
                  onChange={(e) => onChange({ ...hours, [key]: { ...day, open: e.target.value } })}
                />
                <input
                  type="time"
                  dir="ltr"
                  disabled={disabled}
                  value={day.close}
                  onChange={(e) => onChange({ ...hours, [key]: { ...day, close: e.target.value } })}
                />
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  "0": { open: "09:00", close: "21:00", closed: false },
  "1": { open: "09:00", close: "21:00", closed: false },
  "2": { open: "09:00", close: "21:00", closed: false },
  "3": { open: "09:00", close: "21:00", closed: false },
  "4": { open: "09:00", close: "21:00", closed: false },
  "5": { open: "09:00", close: "21:00", closed: true },
  "6": { open: "09:00", close: "21:00", closed: false },
};
