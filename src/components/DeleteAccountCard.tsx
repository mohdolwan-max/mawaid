"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang } from "@/lib/i18n";
import { requestAccountDeletion, cancelAccountDeletion } from "@/app/account/deleteActions";
import { intlLocale } from "@/lib/date";

// Used by both the customer account page and the clinic owner settings
// page — the underlying RPC decides which kind of deletion it is.
export function DeleteAccountCard({
  lang,
  pendingUntil,
}: {
  lang: Lang;
  pendingUntil: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString(intlLocale(lang), { dateStyle: "medium" });

  if (pendingUntil) {
    return (
      <div className="card" style={{ borderColor: "var(--warn-ink)" }}>
        <p style={{ fontWeight: 700, color: "var(--warn-ink)", marginBottom: 6 }}>
          {t(lang, "delete_pending_notice", { date: dateFmt(pendingUntil) })}
        </p>
        <p className="hint" style={{ marginBottom: 12 }}>{t(lang, "delete_undo_note")}</p>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await cancelAccountDeletion();
            setBusy(false);
            router.refresh();
          }}
        >
          {busy ? t(lang, "loading") : t(lang, "delete_undo_cta")}
        </button>
      </div>
    );
  }

  return (
    <div className="card" style={{ borderColor: "var(--bad-ink)" }}>
      <p style={{ fontWeight: 700, color: "var(--bad-ink)", marginBottom: 4 }}>
        {t(lang, "delete_account_title")}
      </p>
      <p className="hint" style={{ marginBottom: 4 }}>{t(lang, "delete_account_hint")}</p>
      <p className="hint" style={{ marginBottom: 12 }}>{t(lang, "delete_account_records_note")}</p>
      {!confirming ? (
        <button type="button" className="btn ghost" onClick={() => setConfirming(true)}>
          {t(lang, "delete_account_cta")}
        </button>
      ) : (
        <div>
          <p style={{ marginBottom: 10 }}>{t(lang, "delete_account_confirm")}</p>
          <div className="toolbar">
            <button
              type="button"
              className="btn"
              style={{ background: "var(--bad-ink)" }}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await requestAccountDeletion();
                setBusy(false);
                router.refresh();
              }}
            >
              {busy ? t(lang, "loading") : t(lang, "delete_account_confirm_cta")}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>
              {t(lang, "cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
