"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { formatPhoneForDisplay } from "@/lib/phone";
import { IMPORT_MAX, previewImport, rowsToSend, type ImportReason } from "@/lib/customerImport";
import { importCustomersAction, type ImportResult } from "../actions";

const REASON: Record<ImportReason | string, TKey> = {
  name: "import_r_name",
  phone: "import_r_phone",
  email: "import_r_email",
  notes: "import_r_notes",
  tags: "import_r_tags",
  duplicate: "import_r_duplicate",
};
const SHOW = 200;

// Paste or open a list, see every row and what will happen to it, then
// confirm. Nothing is written before the confirmation (§2).
export function ImportClient({ lang }: { lang: Lang }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [result, setResult] = useState<Extract<ImportResult, { ok: true }> | null>(null);
  const count = (n: number) => n.toLocaleString(intlLocale(lang));
  const preview = useMemo(() => (text.trim() ? previewImport(text) : null), [text]);
  const good = preview ? preview.rows.filter((r) => r.problem === null) : [];
  const bad = preview ? preview.rows.filter((r) => r.problem !== null) : [];

  async function openFile(file: File) {
    setError(null);
    setResult(null);
    if (file.size > 2_000_000) {
      setError("import_err_file");
      return;
    }
    // A CSV saved by Excel is usually UTF-8; one in the old Arabic Windows
    // code page shows as broken letters, which the preview makes plain.
    setText(await file.text());
  }

  async function confirm() {
    if (!preview || good.length === 0) return;
    setBusy(true);
    setError(null);
    const sent = rowsToSend(preview.rows);
    const r = await importCustomersAction(sent);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setResult(r);
  }

  if (result) {
    // Map the database's positions back to the lines of the list.
    const lines = good.slice(0, IMPORT_MAX).map((r) => r.line);
    return (
      <div className="card">
        <p style={{ fontWeight: 700, marginBottom: 6 }}>{t(lang, "import_done_title")}</p>
        <p>{t(lang, "import_done", { added: count(result.added), updated: count(result.updated) })}</p>
        {result.skipped.length > 0 && (
          <ul className="pkg-list">
            {result.skipped.map((s) => (
              <li key={s.row}>
                {t(lang, "import_line", { n: count(lines[s.row] ?? s.row + 1) })} — {t(lang, REASON[s.reason] ?? "import_r_other")}
              </li>
            ))}
          </ul>
        )}
        <div className="toolbar" style={{ marginTop: 10 }}>
          <Link href="/customers" className="btn">
            {t(lang, "import_see_customers")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <p className="hint" style={{ marginBottom: 8 }}>{t(lang, "import_how")}</p>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <label className="btn ghost sm" style={{ cursor: "pointer" }}>
          {t(lang, "import_open_file")}
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <textarea
        value={text}
        rows={8}
        dir="auto"
        placeholder={t(lang, "import_ph")}
        aria-label={t(lang, "import_title")}
        onChange={(e) => {
          setText(e.target.value);
          setResult(null);
          setError(null);
        }}
      />

      {preview && (
        <>
          <p style={{ fontWeight: 700, margin: "12px 0 6px" }}>
            {t(lang, "import_summary", { good: count(good.length), bad: count(bad.length) })}
          </p>
          {!preview.header && <p className="hint">{t(lang, "import_no_header")}</p>}
          {preview.tooMany && <p className="error-text">{t(lang, "import_err_too_many")}</p>}
          <div className="ac-table-wrap">
            <table className="ac-table">
              <thead>
                <tr>
                  <th>#</th>
                  {/* Status first: on a phone the last columns sit off-screen,
                      and why a row will not import is what matters most. */}
                  <th>{t(lang, "import_col_status")}</th>
                  <th>{t(lang, "customer_name")}</th>
                  <th>{t(lang, "customer_phone")}</th>
                  <th>{t(lang, "import_col_email")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, SHOW).map((r) => (
                  <tr key={r.line}>
                    <td className="num">{count(r.line)}</td>
                    <td>
                      {r.problem === null ? (
                        <span className="chip good">{t(lang, "import_ok")}</span>
                      ) : (
                        <span className="chip bad">{t(lang, REASON[r.problem])}</span>
                      )}
                    </td>
                    <td>{r.name || "—"}</td>
                    <td dir="ltr">{r.problem === "phone" ? r.phone || "—" : formatPhoneForDisplay(r.phone)}</td>
                    <td dir="ltr">{r.email || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rows.length > SHOW && (
            <p className="hint">{t(lang, "import_more", { n: count(preview.rows.length - SHOW) })}</p>
          )}
          <p className="hint" style={{ marginTop: 8 }}>{t(lang, "import_keep_hint")}</p>
          {error && <p className="error-text">{t(lang, error)}</p>}
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" disabled={busy || good.length === 0 || preview.tooMany} onClick={() => void confirm()}>
              {busy ? t(lang, "loading") : t(lang, "import_confirm", { n: count(good.length) })}
            </button>
          </div>
        </>
      )}
      {!preview && error && <p className="error-text">{t(lang, error)}</p>}
    </div>
  );
}
