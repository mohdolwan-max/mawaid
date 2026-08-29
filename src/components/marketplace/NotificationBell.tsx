"use client";

import { useEffect, useRef, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { BellIcon } from "@/components/icons";

// There's no notifications inbox yet (reminders are opt-in push per
// booking, see ReminderOptIn.tsx — not a list of past notices), so this
// honestly says "nothing yet" rather than implying an inbox that
// doesn't exist. Swap in a real unread-count/list once one exists.
export function NotificationBell({ lang }: { lang: Lang }) {
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
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t(lang, "notifications_label")}
        onClick={() => setOpen((o) => !o)}
      >
        <BellIcon size={20} />
      </button>
      {open && (
        <div className="dd-panel notif-panel">
          <p className="hint" style={{ margin: 0, padding: "4px 6px" }}>
            {t(lang, "no_notifications")}
          </p>
        </div>
      )}
    </div>
  );
}
