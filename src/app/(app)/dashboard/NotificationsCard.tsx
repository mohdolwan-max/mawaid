"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang } from "@/lib/i18n";
import { markNotificationsRead } from "./actions";

export type OrgNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

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
              {!n.read_at && <span className="chip warn" style={{ marginInlineEnd: 6 }}>•</span>}
              {t(lang, "notif_booking_cancelled")} — {n.title}
            </span>
          </div>
          {n.body && <p dir="ltr">{n.body}</p>}
          <span className="rv-date">
            {new Date(n.created_at).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", {
              dateStyle: "medium",
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
