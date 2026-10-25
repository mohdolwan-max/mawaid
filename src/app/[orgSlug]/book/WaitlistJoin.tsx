"use client";

import { useState } from "react";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { checkWaitlistForm, WAITLIST_NAME_MAX } from "@/lib/waitlist";
import { joinWaitlistAction } from "./actions";

// Shown where the day has no free time (0066): a customer leaves a name
// and number for that day instead of leaving the page. The visit and the
// specialist already chosen in the wizard are what they wait for.
export function WaitlistJoin({
  lang,
  orgSlug,
  serviceIds,
  staffId,
  day,
  dayLabel,
  defaults,
}: {
  lang: Lang;
  orgSlug: string;
  serviceIds: string[];
  staffId: string | null;
  /** YYYY-MM-DD, the clinic's day. */
  day: string;
  dayLabel: string;
  defaults: { name: string; phone: string; email: string };
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaults.name);
  const [phone, setPhone] = useState(defaults.phone);
  const [email, setEmail] = useState(defaults.email);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const formError = checkWaitlistForm({ name, phone, email });
    if (formError) {
      setError(formError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await joinWaitlistAction({ orgSlug, serviceIds, staffId, day, name, phone, email, website });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDone(true);
    } catch {
      setError("error_generic");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="wl-box wl-done" role="status">
        <p style={{ fontWeight: 700 }}>{t(lang, "wl_joined_title")}</p>
        <p className="hint">
          {t(lang, email.trim() ? "wl_joined_email" : "wl_joined_no_email", { day: dayLabel })}
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="wl-box">
        <p className="hint">{t(lang, "wl_offer", { day: dayLabel })}</p>
        <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
          {t(lang, "wl_join")}
        </button>
      </div>
    );
  }

  return (
    <form className="wl-box" onSubmit={(e) => void submit(e)}>
      <p style={{ fontWeight: 700, marginBottom: 6 }}>{t(lang, "wl_form_title", { day: dayLabel })}</p>
      <div className="field">
        <label htmlFor="wl-name">{t(lang, "customer_name")}</label>
        <input id="wl-name" value={name} maxLength={WAITLIST_NAME_MAX} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="wl-phone">{t(lang, "customer_phone")}</label>
        <input id="wl-phone" value={phone} inputMode="tel" dir="ltr" onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
      </div>
      <div className="field">
        <label htmlFor="wl-email">{t(lang, "wl_email")}</label>
        <input id="wl-email" type="email" value={email} dir="ltr" onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <p className="hint">{t(lang, "wl_email_hint")}</p>
      </div>
      {/* Left empty by people, filled by bots (as on the booking form). */}
      <input
        type="text"
        name="website"
        className="visually-hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
      />
      {error && <p className="error-text">{t(lang, error)}</p>}
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button type="submit" className="btn" disabled={busy}>
          {busy ? t(lang, "loading") : t(lang, "wl_submit")}
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>
          {t(lang, "cancel")}
        </button>
      </div>
    </form>
  );
}
