"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { DateField } from "@/components/DateTimeField";
import { OfferBanner } from "@/components/marketplace/OfferBanner";
import { formatJod } from "@/lib/plan";
import { dateFromYMD, intlLocale } from "@/lib/date";
import {
  OFFER_STATE_TONE,
  OFFER_TITLE_MAX,
  OFFER_TITLE_MIN,
  checkOfferDraft,
  dayStatus,
  daysLabel,
  freePlaces,
  normalizeOfferTitle,
  offerEndDate,
  offerTitleLength,
  offerTotalJod,
  type ActiveBanner,
  type DayAvailability,
  type MyOffer,
  type OfferSetup,
  type OfferState,
} from "@/lib/offers";
import { cancelOfferOrder, createOfferOrder } from "./actions";

export type OfferServiceOption = { id: string; name: string; photo_url: string | null };

/** Days in the picker grid. Longer orders are still checked day by day
 *  against the full availability the server sent. */
const GRID_DAYS = 28;

const STATE_KEY: Record<OfferState, TKey> = {
  awaiting_payment: "offer_state_awaiting_payment",
  expired: "offer_state_expired",
  scheduled: "offer_state_scheduled",
  live: "offer_state_live",
  ended: "offer_state_ended",
  cancelled: "offer_state_cancelled",
  removed: "offer_state_removed",
  needs_refund: "offer_state_needs_refund",
};

/** A YMD is a calendar day: formatted in UTC so the server render and the
 *  browser render print the same date. */
function fmtDay(ymd: string, lang: Lang, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(lang), { timeZone: "UTC", ...opts }).format(dateFromYMD(ymd));
}

const DAY_MONTH: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

export function OffersClient({
  lang,
  setup,
  availability,
  offers,
  services,
  cityName,
  paymentReady,
}: {
  lang: Lang;
  setup: OfferSetup;
  availability: DayAvailability[];
  /** null = the list could not be loaded (said on screen, never "no orders"). */
  offers: MyOffer[] | null;
  /** null = services could not be loaded; the offer can still be placed. */
  services: OfferServiceOption[] | null;
  cityName: string;
  paymentReady: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [serviceId, setServiceId] = useState("");
  const [start, setStart] = useState(setup.today);
  const [daysText, setDaysText] = useState(String(Math.min(7, setup.maxDays)));
  const [serverError, setServerError] = useState<TKey | null>(null);

  const days = Number(daysText);
  const draftError = checkOfferDraft({ title, start, days }, setup, availability);
  // The title rule is not shouted at an empty field the clinic has not
  // reached yet; every other rule shows as soon as it applies.
  const shownError: TKey | null =
    serverError ?? (draftError === "offer_title_length" && !titleTouched ? null : draftError);
  const errorVars = {
    min: OFFER_TITLE_MIN,
    max: OFFER_TITLE_MAX,
    days: setup.maxDays,
    advance: setup.maxAdvanceDays,
  };

  const rangeOk = Number.isInteger(days) && days >= 1 && days <= setup.maxDays;
  const end = rangeOk ? offerEndDate(start, days) : null;
  const total = offerTotalJod(days, setup.pricePerDayJod);
  const titleLen = offerTitleLength(title);
  const service = services?.find((s) => s.id === serviceId) ?? null;
  const currency = t(lang, "currency");

  // The preview is the real banner component fed the draft, so what the
  // clinic sees here is exactly what visitors will get.
  const previewBanner: ActiveBanner = {
    offerId: "preview",
    title: normalizeOfferTitle(title) || t(lang, "offer_title_ph"),
    orgName: setup.orgName,
    orgSlug: setup.orgSlug,
    logoUrl: setup.logoUrl,
    coverUrl: setup.coverUrl,
    serviceId: service?.id ?? null,
    serviceName: service?.name ?? null,
    servicePhotoUrl: service?.photo_url ?? null,
  };

  function editing<V>(setter: (v: V) => void) {
    return (v: V) => {
      setter(v);
      setServerError(null);
    };
  }

  function submit() {
    setTitleTouched(true);
    if (draftError) return;
    setServerError(null);
    startTransition(async () => {
      const res = await createOfferOrder({ title, serviceId: serviceId || null, start, days });
      if ("error" in res) {
        setServerError(res.error);
        return;
      }
      setTitle("");
      setTitleTouched(false);
      router.refresh();
    });
  }

  return (
    <div className="offers-layout">
      <div className="offers-col">
        <div className="card">
          <p className="offer-section-title">{t(lang, "offer_new")}</p>

          <div className="field">
            <label htmlFor="offer-title">{t(lang, "offer_title_label")}</label>
            <input
              id="offer-title"
              value={title}
              placeholder={t(lang, "offer_title_ph")}
              onChange={(e) => editing(setTitle)(e.target.value)}
              onBlur={() => setTitleTouched(true)}
            />
            <p className={`hint offer-count${titleLen > OFFER_TITLE_MAX ? " over" : ""}`}>
              {titleLen} / {OFFER_TITLE_MAX}
            </p>
          </div>

          {services === null ? (
            <p className="hint" style={{ marginBottom: 12 }}>
              {t(lang, "offer_services_failed")}
            </p>
          ) : (
            services.length > 0 && (
              <div className="field">
                <label htmlFor="offer-service">{t(lang, "offer_service_label")}</label>
                <select
                  id="offer-service"
                  value={serviceId}
                  onChange={(e) => editing(setServiceId)(e.target.value)}
                >
                  <option value="">{t(lang, "offer_service_none")}</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="hint">{t(lang, "offer_service_hint")}</p>
              </div>
            )
          )}

          <div className="grid2">
            <div className="field">
              <label>{t(lang, "offer_start_label")}</label>
              <DateField lang={lang} value={start} onChange={editing(setStart)} min={setup.today} />
            </div>
            <div className="field">
              <label htmlFor="offer-days">{t(lang, "offer_days_label")}</label>
              <input
                id="offer-days"
                type="number"
                inputMode="numeric"
                min={1}
                max={setup.maxDays}
                value={daysText}
                onChange={(e) => editing(setDaysText)(e.target.value)}
              />
            </div>
          </div>

          <div className="offer-days" role="group" aria-label={t(lang, "offer_start_label")}>
            {availability.slice(0, GRID_DAYS).map((a) => {
              const status = dayStatus(a, setup.slotsPerDay);
              const inRange = end !== null && a.day >= start && a.day <= end;
              return (
                <button
                  key={a.day}
                  type="button"
                  className={`offer-day ${status}${inRange ? " in-range" : ""}`}
                  disabled={status !== "free"}
                  aria-pressed={a.day === start}
                  onClick={() => editing(setStart)(a.day)}
                >
                  <span className="od-week">{fmtDay(a.day, lang, { weekday: "short" })}</span>
                  <span className="od-date">{fmtDay(a.day, lang, DAY_MONTH)}</span>
                  <span className="od-free">
                    {status === "full"
                      ? t(lang, "offer_day_full")
                      : status === "mine"
                        ? t(lang, "offer_day_mine")
                        : t(lang, "offer_free_slots", { n: freePlaces(a, setup.slotsPerDay) ?? "" })}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="offers-col">
        <div className="card">
          <p className="offer-section-title">{t(lang, "offer_preview_title")}</p>
          <p className="hint" style={{ marginBottom: 10 }}>
            {t(lang, "offer_preview_where", { city: cityName, slots: setup.slotsPerDay })}
          </p>
          <div className="offer-preview-frame">
            <div className="opf-hero">
              <strong>{t(lang, "offer_preview_hero")}</strong>
              <span className="opf-search">{t(lang, "offer_preview_search")}</span>
            </div>
            <span className="opf-label">{t(lang, "offer_preview_here")}</span>
            <OfferBanner banners={[previewBanner]} lang={lang} preview />
            <div className="opf-rest" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>

        <div className="card offer-summary">
          {end && (
            <p className="os-line">
              <span>
                {t(lang, "offer_range", {
                  from: fmtDay(start, lang, DAY_MONTH),
                  to: fmtDay(end, lang, DAY_MONTH),
                })}
              </span>
              <span>{daysLabel(days, lang)}</span>
            </p>
          )}
          <p className="os-line">
            <span>
              {t(lang, "offer_price_per_day", { price: `${formatJod(setup.pricePerDayJod)} ${currency}` })}
            </span>
          </p>
          <p className="os-line os-total-line">
            <span>{t(lang, "offer_total")}</span>
            <span className="os-total">{total === null ? "—" : `${formatJod(total)} ${currency}`}</span>
          </p>

          {shownError && <p className="error-text">{t(lang, shownError, errorVars)}</p>}
          {!paymentReady && <p className="offer-notice">{t(lang, "offer_payment_not_ready")}</p>}
          <p className="hint" style={{ marginBottom: 10 }}>
            {t(lang, "offer_hold_note", { m: setup.holdMinutes })}
          </p>
          <button type="button" className="btn block" disabled={pending} onClick={submit}>
            {t(lang, "offer_pay_cta")}
          </button>
        </div>
      </div>

      <div className="card offers-orders">
        <p className="offer-section-title">{t(lang, "offer_my_orders")}</p>
        {offers === null ? (
          <div className="empty">{t(lang, "offer_orders_failed")}</div>
        ) : offers.length === 0 ? (
          <div className="empty">{t(lang, "offer_orders_empty")}</div>
        ) : (
          offers.map((o) => (
            <OrderRow key={o.id} lang={lang} offer={o} timezone={setup.timezone} paymentReady={paymentReady} />
          ))
        )}
      </div>
    </div>
  );
}

function OrderRow({
  lang,
  offer,
  timezone,
  paymentReady,
}: {
  lang: Lang;
  offer: MyOffer;
  timezone: string;
  paymentReady: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<TKey | null>(null);
  const awaiting = offer.state === "awaiting_payment";

  const holdUntil = new Intl.DateTimeFormat(intlLocale(lang), {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(offer.holdExpiresAt));

  return (
    <div className="offer-order">
      <div className="oo-body">
        <p className="oo-title">{offer.title}</p>
        <p className="oo-meta">
          {t(lang, "offer_range", {
            from: fmtDay(offer.startDate, lang, DAY_MONTH),
            to: fmtDay(offer.endDate, lang, DAY_MONTH),
          })}
          {" · "}
          {daysLabel(offer.days, lang)}
          {" · "}
          {formatJod(offer.totalJod)} {t(lang, "currency")}
          {offer.serviceName ? ` · ${offer.serviceName}` : ""}
        </p>
        {awaiting && <p className="oo-meta">{t(lang, "offer_hold_until", { time: holdUntil })}</p>}
        {awaiting && !paymentReady && <p className="offer-notice">{t(lang, "offer_payment_not_ready")}</p>}
        {error && <p className="error-text">{t(lang, error)}</p>}
      </div>
      <div className="oo-side">
        <span className={`chip ${OFFER_STATE_TONE[offer.state]}`}>{t(lang, STATE_KEY[offer.state])}</span>
        {awaiting && (
          <button
            type="button"
            className="btn ghost sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await cancelOfferOrder(offer.id);
                if (res.error) {
                  setError(res.error);
                  return;
                }
                router.refresh();
              })
            }
          >
            {t(lang, "cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
