"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { daysLabel, planName, type PlanId } from "@/lib/plan";
import {
  PAYMENT_STATUS_TONE,
  defaultPeriod,
  formatAmountJod,
  pickOption,
  type BillingPeriod,
  type Mandate,
  type PaymentRecord,
  type PaymentStatus,
  type PurchaseOption,
} from "@/lib/billing";
import { setAutoRenew, startPlanCheckout } from "./actions";

const STATUS_KEY: Record<PaymentStatus, TKey> = {
  pending: "payment_status_pending",
  paid: "payment_status_paid",
  failed: "payment_status_failed",
  cancelled: "payment_status_cancelled",
  needs_refund: "payment_status_needs_refund",
};

const PERIOD_KEY: Record<BillingPeriod, TKey> = {
  month: "billing_period_month",
  year: "billing_period_year",
};

export function BillingClient({
  lang,
  timezone,
  nowIso,
  currentPlan,
  options,
  payments,
  mandate,
  mandateLoaded,
  paymentReady,
}: {
  lang: Lang;
  timezone: string;
  /** Server render time, so server and browser agree on "starts later". */
  nowIso: string;
  currentPlan: PlanId | null;
  options: PurchaseOption[];
  /** null = history could not be loaded (said on screen, never "no payments"). */
  payments: PaymentRecord[] | null;
  mandate: Mandate | null;
  mandateLoaded: boolean;
  paymentReady: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const planIds = [...new Set(options.map((o) => o.planId))];
  const [planId, setPlanId] = useState<PlanId>(
    currentPlan && planIds.includes(currentPlan) ? currentPlan : planIds[0]
  );
  const [period, setPeriod] = useState<BillingPeriod>(defaultPeriod(mandate));
  const [saveCard, setSaveCard] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

  const option = pickOption(options, planId, period);
  const currency = t(lang, "currency");
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale(lang), { timeZone: timezone, dateStyle: "medium" }).format(new Date(iso));
  // More than a minute after now: the new period queues behind the current one.
  const startsLater = option ? Date.parse(option.startsAt) - Date.parse(nowIso) > 60_000 : false;

  function pay() {
    if (!option) return;
    setError(null);
    startTransition(async () => {
      const res = await startPlanCheckout({ planId, period, saveCard });
      if ("url" in res) {
        window.location.assign(res.url);
        return;
      }
      setError(res.error);
    });
  }

  function toggleRenew(active: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setAutoRenew(active);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="billing-layout">
      <div className="card">
        <p className="offer-section-title">{t(lang, "billing_choose_plan")}</p>

        <div className="billing-period" role="group">
          {(["month", "year"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {t(lang, PERIOD_KEY[p])}
            </button>
          ))}
        </div>

        <div className="billing-plans" role="group">
          {planIds.map((id) => {
            const o = pickOption(options, id, period);
            return (
              <button
                key={id}
                type="button"
                className="billing-plan"
                aria-pressed={planId === id}
                disabled={!o}
                onClick={() => setPlanId(id)}
              >
                <span className="bp-name">
                  {planName(id, lang)}
                  {currentPlan === id && <span className="bp-current">{t(lang, "plan_card_title")}</span>}
                </span>
                <span className="bp-price">{o ? `${formatAmountJod(o.amountJod)} ${currency}` : "—"}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card billing-summary">
        {option ? (
          <>
            <p className="bs-total">{`${formatAmountJod(option.amountJod)} ${currency}`}</p>
            <p>{t(lang, "billing_window", { from: fmtDate(option.startsAt), to: fmtDate(option.endsAt) })}</p>
            {startsLater && <p className="hint">{t(lang, "billing_starts_later")}</p>}
            {option.creditDays > 0 && (
              <p className="hint">{t(lang, "billing_credit", { days: daysLabel(option.creditDays, lang) })}</p>
            )}

            <label className="billing-check">
              <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} />
              <span>
                {t(lang, "billing_save_card")}
                <span className="hint" style={{ display: "block", fontWeight: 400 }}>
                  {t(lang, "billing_save_card_hint")}
                </span>
              </span>
            </label>

            {!paymentReady && <p className="offer-notice">{t(lang, "billing_not_ready")}</p>}
            {error && <p className="error-text">{t(lang, error)}</p>}
            <button type="button" className="btn block" disabled={pending || !paymentReady} onClick={pay}>
              {t(lang, "billing_pay", { amount: `${formatAmountJod(option.amountJod)} ${currency}` })}
            </button>
          </>
        ) : (
          <p className="hint">—</p>
        )}
      </div>

      <div className="card billing-wide">
        <p className="offer-section-title">{t(lang, "billing_auto_title")}</p>
        {!mandateLoaded ? (
          <p className="hint">{t(lang, "billing_mandate_failed")}</p>
        ) : !mandate ? (
          <p className="hint">{t(lang, "billing_no_saved_card")}</p>
        ) : (
          <div className="billing-row">
            <div>
              <p className="br-title">
                {mandate.active
                  ? t(lang, "billing_auto_on", {
                      plan: planName(mandate.planId, lang),
                      period: t(lang, PERIOD_KEY[mandate.period]),
                    })
                  : t(lang, "billing_auto_off")}
              </p>
              {mandate.cardLabel && (
                <p className="br-meta">{t(lang, "billing_auto_card", { card: mandate.cardLabel })}</p>
              )}
              {mandate.lastError && (
                <p className="br-meta error-text">{t(lang, "billing_auto_last_error", { error: mandate.lastError })}</p>
              )}
            </div>
            <div className="br-side">
              <button
                type="button"
                className={`btn sm${mandate.active ? " ghost" : ""}`}
                disabled={pending}
                onClick={() => toggleRenew(!mandate.active)}
              >
                {t(lang, mandate.active ? "billing_auto_stop" : "billing_auto_start")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="card billing-wide">
        <p className="offer-section-title">{t(lang, "billing_history_title")}</p>
        {payments === null ? (
          <div className="empty">{t(lang, "billing_history_failed")}</div>
        ) : payments.length === 0 ? (
          <div className="empty">{t(lang, "billing_history_empty")}</div>
        ) : (
          payments.map((p) => (
            <div key={p.id} className="billing-row">
              <div>
                <p className="br-title">
                  {p.kind === "offer"
                    ? t(lang, "billing_item_offer", { title: p.offerTitle ?? "—" })
                    : t(lang, "billing_item_plan", {
                        plan: p.planId ? planName(p.planId, lang) : "—",
                        period: p.period ? t(lang, PERIOD_KEY[p.period]) : "",
                      })}
                </p>
                <p className="br-meta">
                  {fmtDate(p.paidAt ?? p.createdAt)}
                  {p.isRenewal ? ` · ${t(lang, "billing_item_renewal")}` : ""}
                  {p.planEndsAt ? ` · ${t(lang, "billing_window", { from: "", to: fmtDate(p.planEndsAt) }).trim()}` : ""}
                </p>
              </div>
              <div className="br-side">
                <span>{`${formatAmountJod(p.amountJod)} ${currency}`}</span>
                <span className={`chip ${PAYMENT_STATUS_TONE[p.status]}`}>{t(lang, STATUS_KEY[p.status])}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
