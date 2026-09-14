"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { isPlanId, planName } from "@/lib/plan";
import { PAYMENT_STATUS_TONE, formatPrice, type PaymentStatus } from "@/lib/billing";
import { ADMIN_TZ, reasonOk, type AdminPayment } from "@/lib/admin";
import { adminMarkRefunded } from "../actions";

const STATUS_KEY: Record<PaymentStatus, TKey> = {
  pending: "payment_status_pending",
  paid: "payment_status_paid",
  failed: "payment_status_failed",
  cancelled: "payment_status_cancelled",
  needs_refund: "payment_status_needs_refund",
  refunded: "payment_status_refunded",
};

const FILTERS: (PaymentStatus | "all")[] = ["all", "paid", "needs_refund", "failed", "refunded", "pending"];

export function PaymentsClient({ lang, payments }: { lang: Lang; payments: AdminPayment[] }) {
  // Opens on what needs a person, when there is any.
  const [filter, setFilter] = useState<PaymentStatus | "all">(
    payments.some((p) => p.status === "needs_refund") ? "needs_refund" : "all"
  );
  const shown = payments.filter((p) => filter === "all" || p.status === filter);

  return (
    <>
      <div className="admin-chips" role="group">
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {t(lang, f === "all" ? "admin_filter_all" : STATUS_KEY[f])}{" "}
            <span>{f === "all" ? payments.length : payments.filter((p) => p.status === f).length}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="empty">{t(lang, "admin_payments_empty")}</div>
      ) : (
        <div className="admin-list">
          {shown.map((p) => (
            <PaymentRow key={p.id} lang={lang} payment={p} />
          ))}
        </div>
      )}
    </>
  );
}

function PaymentRow({ lang, payment: p }: { lang: Lang; payment: AdminPayment }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

  const when = new Intl.DateTimeFormat(intlLocale(lang), {
    timeZone: ADMIN_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(p.paidAt ?? p.createdAt));

  const item =
    p.kind === "offer"
      ? t(lang, "billing_item_offer", { title: p.offerTitle ?? "—" })
      : t(lang, "billing_item_plan", {
          plan: p.planId && isPlanId(p.planId) ? planName(p.planId, lang) : (p.planId ?? "—"),
          period: p.period ? t(lang, p.period === "year" ? "billing_period_year" : "billing_period_month") : "",
        });
  const detail = p.refundNote ?? p.failureReason ?? p.outcome;

  function apply() {
    setError(null);
    startTransition(async () => {
      const res = await adminMarkRefunded({ paymentId: p.id, note });
      if (res.error) {
        setError(res.error);
        return;
      }
      setReviewing(false);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="admin-row">
      <div className="ar-head static">
        <span className="ar-title">
          <strong>{p.orgName}</strong>
          <span className="hint">{item}</span>
        </span>
        <span className="ar-chips">
          <span className="num">{formatPrice(p.amount, p.currency, lang)}</span>
          <span className={`chip ${PAYMENT_STATUS_TONE[p.status]}`}>{t(lang, STATUS_KEY[p.status])}</span>
        </span>
      </div>
      <div className="ar-meta">
        <span>{when}</span>
        {p.isRenewal && <span>{t(lang, "billing_item_renewal")}</span>}
        {p.providerRef && (
          <span dir="ltr">
            <code>{p.providerRef}</code>
          </span>
        )}
      </div>
      {detail && (
        <p className="ar-detail" dir="auto">
          <code>{detail}</code>
        </p>
      )}

      {p.status === "needs_refund" && (
        <div className="ar-body">
          {!open ? (
            <button type="button" className="btn sm" onClick={() => setOpen(true)}>
              {t(lang, "admin_mark_refunded")}
            </button>
          ) : (
            <div className="admin-tool">
              <div className="field">
                <label>{t(lang, "admin_reason")}</label>
                <input
                  value={note}
                  placeholder={t(lang, "admin_refund_note_ph")}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setReviewing(false);
                  }}
                />
              </div>
              {reviewing && (
                <p className="admin-confirm">
                  {t(lang, "admin_confirm_refund", {
                    amount: formatPrice(p.amount, p.currency, lang),
                    clinic: p.orgName,
                  })}
                </p>
              )}
              {error && <p className="error-text">{t(lang, error)}</p>}
              <div className="toolbar">
                {!reviewing ? (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      if (!reasonOk(note)) {
                        setError("admin_err_reason");
                        return;
                      }
                      setError(null);
                      setReviewing(true);
                    }}
                  >
                    {t(lang, "admin_review")}
                  </button>
                ) : (
                  <button type="button" className="btn sm" disabled={pending} onClick={apply}>
                    {t(lang, "admin_confirm")}
                  </button>
                )}
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={pending}
                  onClick={() => {
                    setOpen(false);
                    setReviewing(false);
                    setError(null);
                  }}
                >
                  {t(lang, "cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
