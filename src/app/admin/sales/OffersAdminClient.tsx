"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { formatPrice } from "@/lib/billing";
import { offerTiming, reasonOk, type AdminOffer } from "@/lib/admin";
import { adminRemoveOffer } from "../actions";

const TIMING_KEY = {
  live: "admin_offer_live",
  scheduled: "admin_offer_scheduled",
  ended: "admin_offer_ended",
} as const satisfies Record<string, TKey>;

const TIMING_TONE = { live: "good", scheduled: "neutral", ended: "neutral" } as const;

export function OffersAdminClient({ lang, offers, today }: { lang: Lang; offers: AdminOffer[]; today: string }) {
  if (offers.length === 0) return <div className="empty">{t(lang, "admin_offers_empty")}</div>;
  return (
    <div className="admin-list">
      {offers.map((o) => (
        <OfferRow key={o.id} lang={lang} offer={o} today={today} />
      ))}
    </div>
  );
}

function OfferRow({ lang, offer: o, today }: { lang: Lang; offer: AdminOffer; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

  const timing = offerTiming(o, today);
  const fmtDay = (ymd: string) =>
    new Intl.DateTimeFormat(intlLocale(lang), { timeZone: "UTC", day: "numeric", month: "short" }).format(
      new Date(`${ymd}T00:00:00Z`)
    );

  const chip =
    timing === "other"
      ? { key: (o.status === "removed" ? "admin_offer_removed" : "admin_offer_needs_refund") as TKey, tone: o.status === "removed" ? "neutral" : "bad" }
      : { key: TIMING_KEY[timing] as TKey, tone: TIMING_TONE[timing] };
  const removable = timing === "live" || timing === "scheduled";

  function apply() {
    setError(null);
    startTransition(async () => {
      const res = await adminRemoveOffer({ offerId: o.id, reason });
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setReviewing(false);
      router.refresh();
    });
  }

  return (
    <div className="admin-row">
      <div className="ar-head static">
        <span className="ar-title">
          <strong>{o.title}</strong>
          <span className="hint">{o.orgName}</span>
        </span>
        <span className="ar-chips">
          <span className="num">{formatPrice(o.totalJod, "JOD", lang)}</span>
          <span className={`chip ${chip.tone}`}>{t(lang, chip.key)}</span>
        </span>
      </div>
      <div className="ar-meta">
        <span>{t(lang, "offer_range", { from: fmtDay(o.startDate), to: fmtDay(o.endDate) })}</span>
        {o.removedReason && <span>{o.removedReason}</span>}
      </div>

      {removable && (
        <div className="ar-body">
          {!open ? (
            <button type="button" className="btn danger sm" onClick={() => setOpen(true)}>
              {t(lang, "admin_remove_offer")}
            </button>
          ) : (
            <div className="admin-tool">
              <div className="field">
                <label>{t(lang, "admin_reason")}</label>
                <input
                  value={reason}
                  placeholder={t(lang, "admin_remove_reason_ph")}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setReviewing(false);
                  }}
                />
              </div>
              {reviewing && <p className="admin-confirm">{t(lang, "admin_confirm_remove", { title: o.title })}</p>}
              {error && <p className="error-text">{t(lang, error)}</p>}
              <div className="toolbar">
                {!reviewing ? (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      if (!reasonOk(reason)) {
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
                  <button type="button" className="btn danger sm" disabled={pending} onClick={apply}>
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
