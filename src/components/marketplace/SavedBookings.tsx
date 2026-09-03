"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { CalendarIcon } from "@/components/icons";

// A guest who books without an email sees the manage link exactly once,
// on the success screen. Close the tab and the booking is gone for them
// — the clinic can still cancel it, the customer cannot (owner, 2026-09:
// "حجز لا يمكن التراجع عنه"). BookingClient now leaves a pointer in this
// device's storage; this surfaces it on the home page.
//
// Deliberately local-only and unauthenticated: the token IS the
// capability, so nothing here needs a session, and nothing is sent
// anywhere. A different device or a cleared browser simply shows
// nothing — which is why this is a convenience on top of the emailed
// link, not a replacement for it.
type Saved = { token: string; orgSlug: string; at: string };

export function SavedBookings({ lang }: { lang: Lang }) {
  const [rows, setRows] = useState<Saved[]>([]);

  useEffect(() => {
    try {
      const raw: Saved[] = JSON.parse(localStorage.getItem("maw3ed_bookings") ?? "[]");
      const now = Date.now();
      // Past bookings are not "upcoming" and must not be shown as such;
      // they are also pruned so the list cannot grow forever.
      const upcoming = raw.filter(
        (b) => b && typeof b.token === "string" && b.at && new Date(b.at).getTime() > now
      );
      setRows(upcoming.slice(0, 3));
      if (upcoming.length !== raw.length) {
        localStorage.setItem("maw3ed_bookings", JSON.stringify(upcoming));
      }
    } catch {
      // Storage blocked or corrupt: show nothing, break nothing.
    }
  }, []);

  if (rows.length === 0) return null;

  return (
    <section className="saved-bookings">
      {rows.map((b) => (
        <Link key={b.token} href={`/${b.orgSlug}/booking/${b.token}`} className="sb-row">
          <CalendarIcon size={16} />
          <span className="sb-text">
            <strong>{t(lang, "saved_booking_title")}</strong>
            <span dir="auto">
              {new Date(b.at).toLocaleString(intlLocale(lang), {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </span>
          <span className="sb-cta">{t(lang, "saved_booking_manage")}</span>
        </Link>
      ))}
    </section>
  );
}
