"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { markNotificationsRead } from "./actions";
import { intlLocale } from "@/lib/date";

export type OrgNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

// kind comes from the database CHECK (0029), but an unknown value must
// not render a raw key at a clinic owner — fall back to the neutral one.
function labelFor(kind: string): TKey {
  return kind === "booking_created" ? "notif_booking_created" : "notif_booking_cancelled";
}

export function NotificationsCard({
  lang,
  notifications,
}: {
  lang: Lang;
  notifications: OrgNotification[];
}) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const unread = notifications.filter((n) => !n.read_at).length;

  if (notifications.length === 0) return null;

  return (
    <div className="card">
      <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <p style={{ fontWeight: 700 }}>
          {t(lang, "notifications_title")}
          {unread > 0 && <span className="chip warn" style={{ marginInlineStart: 8 }}>{unread}</span>}
        </p>
        {unread > 0 && (
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await markNotificationsRead();
              setBusy(false);
              router.refresh();
            }}
          >
            {t(lang, "notif_mark_read")}
          </button>
        )}
      </div>
      {notifications.map((n) => (
        <div key={n.id} className="review-row">
          <div className="rv-head">
            <span className="rv-name">
              {!n.read_at && (
              <span
                className={`chip ${n.kind === "booking_cancelled" ? "bad" : "good"}`}
                style={{ marginInlineEnd: 6 }}
              >
                •
              </span>
            )}
              {t(lang, labelFor(n.kind))} — {n.title}
            </span>
          </div>
          {n.body && <p dir="auto">{n.body}</p>}
          <span className="rv-date">
            {new Date(n.created_at).toLocaleDateString(intlLocale(lang), {
              dateStyle: "medium",
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
