"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale, todayYMD } from "@/lib/date";
import { DateField } from "@/components/DateTimeField";
import { fetchRescheduleSlotsAction, rescheduleAction } from "./actions";

// Moving an appointment must offer the SAME grid the customer booked
// from — a free-text time field would just produce errors, which is the
// lesson already recorded on the owner's manual booking form.
export function RescheduleCard({
  lang,
  token,
  orgSlug,
  serviceId,
  staffId,
  timezone,
}: {
  lang: Lang;
  token: string;
  orgSlug: string;
  serviceId: string;
  staffId: string | null;
  timezone: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayYMD(timezone));
  const [slots, setSlots] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const locale = intlLocale(lang);

  async function load(d: string) {
    setLoading(true);
    setError(null);
    setPicked(null);
    try {
      setSlots(await fetchRescheduleSlotsAction(orgSlug, serviceId, d, staffId));
    } catch {
      // Not an empty list: "no times" and "the lookup broke" must not
      // look identical to the customer.
      setSlots(null);
      setError("error_generic");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn ghost"
        onClick={() => {
          setOpen(true);
          void load(date);
        }}
      >
        {t(lang, "resched_cta")}
      </button>
    );
  }

  return (
    <div className="resched">
      <p style={{ fontWeight: 700, marginBottom: 8 }}>{t(lang, "resched_title")}</p>

      <DateField
        lang={lang}
        value={date}
        min={todayYMD(timezone)}
        onChange={(d) => {
          setDate(d);
          void load(d);
        }}
      />

      {loading && <p className="hint">{t(lang, "loading")}</p>}

      {!loading && slots !== null && slots.length === 0 && (
        <p className="hint">{t(lang, "book_no_slots")}</p>
      )}

      {!loading && slots !== null && slots.length > 0 && (
        <div className="slot-grid" style={{ marginTop: 10 }}>
          {slots.map((s) => (
            <button
              key={s}
              type="button"
              className={`slot-btn ${picked === s ? "selected" : ""}`}
              onClick={() => setPicked(s)}
            >
              {new Date(s).toLocaleTimeString(locale, {
                timeZone: timezone,
                hour: "numeric",
                minute: "2-digit",
              })}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error-text">{t(lang, error)}</p>}

      <div className="toolbar" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn"
          disabled={!picked || pending}
          onClick={async () => {
            if (!picked) return;
            setPending(true);
            setError(null);
            const r = await rescheduleAction(token, picked);
            setPending(false);
            if (!r.ok) {
              setError(r.error as TKey);
              // The slot may have gone in the meantime; reload the grid
              // so the customer is not staring at a stale option.
              if (r.error === "book_slot_taken") void load(date);
              return;
            }
            router.refresh();
          }}
        >
          {pending ? t(lang, "loading") : t(lang, "resched_confirm")}
        </button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          {t(lang, "resched_keep")}
        </button>
      </div>
    </div>
  );
}
