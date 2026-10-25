"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { cleanTags, type CustomerNote } from "@/lib/customerFile";
import { addCustomerNoteAction, deleteCustomerNoteAction, setCustomerTagsAction } from "../actions";

// Tags: one text field, comma-separated, saved together. Shown as chips
// once saved; the field always holds what was last saved.
export function CustomerTags({ lang, phone, initial }: { lang: Lang; phone: string; initial: string[] }) {
  const router = useRouter();
  const [value, setValue] = useState(initial.join("، "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [saved, setSaved] = useState(false);
  const preview = cleanTags(value);

  async function save() {
    if (!preview.ok) {
      setError("cust_tags_invalid");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    const r = await setCustomerTagsAction(phone, value);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="card">
      <p style={{ fontWeight: 700, marginBottom: 4 }}>{t(lang, "cust_tags_title")}</p>
      <p className="hint" style={{ marginBottom: 8 }}>{t(lang, "cust_tags_hint")}</p>
      <div className="cust-tags">
        {preview.tags.map((tag) => (
          <span key={tag} className="chip neutral">
            {tag}
          </span>
        ))}
      </div>
      <div className="toolbar" style={{ marginTop: 8 }}>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          aria-label={t(lang, "cust_tags_title")}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn ghost" disabled={saving} onClick={() => void save()}>
          {saving ? t(lang, "loading") : t(lang, "cust_tags_save")}
        </button>
      </div>
      {error && <p className="error-text">{t(lang, error)}</p>}
      {saved && <p className="hint" style={{ color: "var(--good-ink)" }}>{t(lang, "save_ok")}</p>}
    </div>
  );
}

// Notes: newest first; deletable by their author or the clinic's owner
// (0062 decides; the button only appears where it would succeed).
export function CustomerNotes({
  lang,
  phone,
  notes,
  timezone,
}: {
  lang: Lang;
  phone: string;
  notes: CustomerNote[];
  timezone: string;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const when = (iso: string) =>
    iso
      ? new Intl.DateTimeFormat(intlLocale(lang), { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
      : "";

  async function add() {
    setSaving(true);
    setError(null);
    const r = await addCustomerNoteAction(phone, body);
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setBody("");
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm(t(lang, "cust_note_confirm_delete"))) return;
    const r = await deleteCustomerNoteAction(phone, id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="card">
      <p style={{ fontWeight: 700, marginBottom: 4 }}>{t(lang, "cust_notes_title")}</p>
      <p className="hint" style={{ marginBottom: 8 }}>{t(lang, "cust_notes_hint")}</p>
      <textarea
        value={body}
        maxLength={2000}
        placeholder={t(lang, "cust_note_ph")}
        aria-label={t(lang, "cust_notes_title")}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="toolbar" style={{ marginTop: 8 }}>
        <button type="button" className="btn" disabled={saving || body.trim() === ""} onClick={() => void add()}>
          {saving ? t(lang, "loading") : t(lang, "cust_note_add")}
        </button>
      </div>
      {error && <p className="error-text">{t(lang, error)}</p>}
      {notes.length === 0 ? (
        <p className="hint" style={{ marginTop: 10 }}>{t(lang, "cust_notes_empty")}</p>
      ) : (
        <ul className="cust-notes">
          {notes.map((n) => (
            <li key={n.id}>
              <p className="cust-note-body">{n.body}</p>
              <p className="hint">
                {[n.author, when(n.createdAt)].filter(Boolean).join(" · ")}
                {n.canDelete && (
                  <button type="button" className="link-btn" onClick={() => void remove(n.id)}>
                    {t(lang, "cust_note_delete")}
                  </button>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
