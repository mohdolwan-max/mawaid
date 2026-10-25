"use client";

import { useState } from "react";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { adminSetSupportContact } from "./actions";

// The support number and email the clinics see on their Help page (0074).
// Empty number: the clinics see the email only.
export function SupportContactForm({ lang, whatsapp, email }: { lang: Lang; whatsapp: string; email: string }) {
  const [wa, setWa] = useState(whatsapp);
  const [mail, setMail] = useState(email);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; key: TKey } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await adminSetSupportContact(wa, mail);
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, key: r.error });
      return;
    }
    setWa(r.whatsapp ?? "");
    setMail(r.email ?? "");
    setMsg({ ok: true, key: "save_ok" });
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <p style={{ fontWeight: 700, marginBottom: 4 }}>{t(lang, "support_admin_title")}</p>
      <p className="hint" style={{ marginBottom: 8 }}>{t(lang, "support_admin_sub")}</p>
      <div className="grid2">
        <div className="field">
          <label htmlFor="sup-wa">{t(lang, "support_admin_whatsapp")}</label>
          <input id="sup-wa" dir="ltr" inputMode="tel" value={wa} placeholder="962790000000" onChange={(e) => setWa(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sup-mail">{t(lang, "support_admin_email")}</label>
          <input id="sup-mail" dir="ltr" type="email" value={mail} onChange={(e) => setMail(e.target.value)} />
        </div>
      </div>
      {msg && <p className={msg.ok ? "hint" : "error-text"} style={msg.ok ? { color: "var(--good-ink)" } : undefined}>{t(lang, msg.key)}</p>}
      <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
        {busy ? t(lang, "loading") : t(lang, "save")}
      </button>
    </div>
  );
}
