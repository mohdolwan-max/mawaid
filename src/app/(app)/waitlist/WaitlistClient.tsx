"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { formatPhoneForDisplay } from "@/lib/phone";
import { waitlistWhatsappUrl } from "@/lib/waitlist";
import { removeWaitlistAction } from "./actions";

export type WaitlistRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  services: string;
  /** The specialist asked for; null = anyone. */
  staff: string | null;
  /** A time that day was given up since they joined. */
  freed: boolean;
  /** They were emailed about it. */
  emailed: boolean;
  /** Free times for them right now; null = not checked. */
  freeCount: number | null;
  firstFree: string | null;
};

export function WaitlistClient({
  lang,
  orgName,
  groups,
}: {
  lang: Lang;
  orgName: string;
  groups: { day: string; label: string; rows: WaitlistRow[] }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<TKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const count = (n: number) => n.toLocaleString(intlLocale(lang));

  async function remove(row: WaitlistRow) {
    if (!window.confirm(t(lang, "wl_remove_confirm", { name: row.name }))) return;
    setBusy(row.id);
    setError(null);
    const r = await removeWaitlistAction(row.id);
    setBusy(null);
    if (!r.ok) {
      setError("error_generic");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {error && <p className="error-text">{t(lang, error)}</p>}
      {groups.map((g) => (
        <div key={g.day} className="card" style={{ marginBottom: 12 }}>
          <p style={{ fontWeight: 700, marginBottom: 6 }}>
            {g.label} <span className="hint">· {t(lang, "wl_waiting_n", { n: count(g.rows.length) })}</span>
          </p>
          <ul className="pkg-list">
            {g.rows.map((r) => {
              const message =
                r.firstFree !== null
                  ? t(lang, "wl_wa_free", { name: r.name, org: orgName, day: g.label, time: r.firstFree })
                  : t(lang, "wl_wa_generic", { name: r.name, org: orgName, day: g.label });
              const wa = waitlistWhatsappUrl(r.phone, message);
              const book = `/bookings?${new URLSearchParams({ new: "1", name: r.name, phone: r.phone, ...(r.email ? { email: r.email } : {}) })}`;
              return (
                <li key={r.id}>
                  <div className="cv-top">
                    <strong>{r.name}</strong>
                    {r.freeCount === null ? null : r.freeCount > 0 ? (
                      <span className="chip good">{t(lang, "wl_free_now", { n: count(r.freeCount), time: r.firstFree ?? "" })}</span>
                    ) : (
                      <span className="chip neutral">{t(lang, "wl_none_now")}</span>
                    )}
                  </div>
                  <p className="cv-what">
                    {[r.services, r.staff ?? t(lang, "wl_any_staff")].join(" · ")}
                  </p>
                  <p className="hint">
                    <bdi dir="ltr">{formatPhoneForDisplay(r.phone)}</bdi>
                    {r.freed && <> · {t(lang, r.emailed ? "wl_freed_emailed" : r.email ? "wl_freed_pending" : "wl_freed_no_email")}</>}
                  </p>
                  <div className="toolbar" style={{ marginTop: 6 }}>
                    {wa && (
                      <a href={wa} target="_blank" rel="noopener noreferrer" className="btn ghost sm">
                        {t(lang, "cust_whatsapp")}
                      </a>
                    )}
                    <a href={`tel:${r.phone}`} className="btn ghost sm">
                      {t(lang, "cust_call")}
                    </a>
                    <Link href={book} className="btn ghost sm">
                      {t(lang, "cust_new_booking")}
                    </Link>
                    <button type="button" className="btn danger sm" disabled={busy === r.id} onClick={() => void remove(r)}>
                      {t(lang, "wl_remove")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
