"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { reasonOk } from "@/lib/admin";
import { currencyLabel, formatPrice } from "@/lib/billing";
import { planName, isPlanId } from "@/lib/plan";
import { parsePriceInput, type AdminMarket, type MarketMissing } from "@/lib/adminMarkets";
import {
  adminSaveMarket,
  adminSaveOfferSettings,
  adminSavePlanPrice,
  type AdminActionError,
} from "../actions";

const MISSING_KEY: Record<MarketMissing, TKey> = {
  plan_prices: "markets_missing_prices",
  offer_settings: "markets_missing_offers",
  tax_registration: "markets_missing_tax",
};

const ERROR_KEY: Record<AdminActionError, TKey> = {
  admin_err_not_admin: "admin_err_not_admin",
  admin_err_reason: "admin_err_reason",
  admin_err_not_trial: "admin_err_not_trial",
  admin_err_org_closed: "admin_err_org_closed",
  admin_err_not_refundable: "admin_err_not_refundable",
  admin_err_offer_not_removable: "admin_err_offer_not_removable",
  admin_err_country: "admin_err_country",
  admin_err_city_country: "admin_err_city_country",
  admin_err_market_not_ready: "admin_err_market_not_ready",
  admin_err_open_needs_prices: "admin_err_open_needs_prices",
  admin_err_price: "admin_err_price",
  admin_err_offer_settings: "admin_err_offer_settings",
  error_generic: "error_generic",
};

export function MarketsClient({
  lang,
  markets,
  gatewayReady,
}: {
  lang: Lang;
  markets: AdminMarket[];
  /** Whether each country's gateway keys are set on the server. */
  gatewayReady: Record<string, boolean>;
}) {
  return (
    <div className="markets">
      {markets.map((m) => (
        <MarketCard key={m.code} lang={lang} market={m} gatewayReady={gatewayReady[m.code] === true} />
      ))}
    </div>
  );
}

function MarketCard({ lang, market: m, gatewayReady }: { lang: Lang; market: AdminMarket; gatewayReady: boolean }) {
  const name = lang === "ar" ? m.nameAr : m.nameEn;
  const ready = m.missing.length === 0 && gatewayReady;

  return (
    <div className="card market-card">
      <div className="tax-reg-head">
        <strong>
          {name} · {m.currency}
        </strong>
        <span className="ar-chips">
          <span className={`chip ${m.signupOpen ? "good" : "neutral"}`}>
            {t(lang, m.signupOpen ? "markets_signup_open" : "markets_signup_closed")}
          </span>
          <span className={`chip ${m.listed ? "good" : "neutral"}`}>
            {t(lang, m.listed ? "markets_listed" : "markets_hidden")}
          </span>
        </span>
      </div>
      <div className="ar-meta">
        <span>{t(lang, "markets_clinics", { n: m.clinics === null ? "—" : m.clinics.toLocaleString(intlLocale(lang)) })}</span>
        {m.taxRegistration && (
          <span>
            {t(lang, "markets_tax_reg", { name: m.taxRegistration.legalName, n: m.taxRegistration.taxNumber })}
          </span>
        )}
      </div>

      {/* What still stands between this country and its first clinic. */}
      {!ready && (
        <ul className="market-missing">
          {m.missing.map((x) => (
            <li key={x}>{t(lang, MISSING_KEY[x])}</li>
          ))}
          {!gatewayReady && (
            <li>
              {t(lang, "markets_missing_gateway")}
              <code className="market-env" dir="ltr">
                PAYTABS_{m.code}_PROFILE_ID · PAYTABS_{m.code}_SERVER_KEY
              </code>
            </li>
          )}
        </ul>
      )}

      <SwitchTool lang={lang} market={m} canOpen={ready} />
      <PricesTool lang={lang} market={m} />
      <OfferTool lang={lang} market={m} />
    </div>
  );
}

function useTool() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [done, setDone] = useState(false);

  function touch() {
    setReviewing(false);
    setDone(false);
  }

  function review(extraCheck?: () => TKey | null) {
    setDone(false);
    const bad = extraCheck?.() ?? null;
    if (bad) {
      setError(bad);
      return;
    }
    if (!reasonOk(reason)) {
      setError("admin_err_reason");
      return;
    }
    setError(null);
    setReviewing(true);
  }

  function run(action: () => Promise<{ error?: AdminActionError }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) {
        setError(ERROR_KEY[res.error]);
        setReviewing(false);
        return;
      }
      setReviewing(false);
      setReason("");
      setDone(true);
      router.refresh();
    });
  }

  return { pending, reason, setReason, reviewing, setReviewing, error, done, touch, review, run };
}

function ToolFooter({
  lang,
  tool,
  onConfirm,
  confirmText,
}: {
  lang: Lang;
  tool: ReturnType<typeof useTool>;
  onConfirm: () => void;
  confirmText: string;
  }) {
  return (
    <>
      <div className="field">
        <label>{t(lang, "admin_reason")}</label>
        <input
          value={tool.reason}
          placeholder={t(lang, "admin_reason_ph")}
          onChange={(e) => {
            tool.setReason(e.target.value);
            tool.touch();
          }}
        />
      </div>
      {tool.reviewing && <p className="admin-confirm">{confirmText}</p>}
      {tool.error && <p className="error-text">{t(lang, tool.error)}</p>}
      {tool.done && <p className="hint">{t(lang, "admin_done")}</p>}
      <div className="toolbar">
        {!tool.reviewing ? null : (
          <>
            <button type="button" className="btn sm" disabled={tool.pending} onClick={onConfirm}>
              {t(lang, "admin_confirm")}
            </button>
            <button type="button" className="btn ghost sm" disabled={tool.pending} onClick={() => tool.setReviewing(false)}>
              {t(lang, "admin_back")}
            </button>
          </>
        )}
      </div>
    </>
  );
}

// Open for sign-up / shown to customers. Opening is refused until the
// country is ready: the database checks prices, offers and tax, and this
// page checks the gateway keys it can see.
function SwitchTool({ lang, market: m, canOpen }: { lang: Lang; market: AdminMarket; canOpen: boolean }) {
  const tool = useTool();
  const [signupOpen, setSignupOpen] = useState(m.signupOpen);
  const [listed, setListed] = useState(m.listed);
  const opening = signupOpen && !m.signupOpen;
  const unchanged = signupOpen === m.signupOpen && listed === m.listed;
  const name = lang === "ar" ? m.nameAr : m.nameEn;

  return (
    <div className="admin-tool">
      <p className="at-tool-title">{t(lang, "markets_switch_title")}</p>
      <label className="admin-check">
        <input
          type="checkbox"
          checked={signupOpen}
          disabled={!m.signupOpen && !canOpen}
          onChange={(e) => {
            setSignupOpen(e.target.checked);
            tool.touch();
          }}
        />
        {t(lang, "markets_signup_label")}
      </label>
      {!m.signupOpen && !canOpen && <p className="hint">{t(lang, "markets_cannot_open")}</p>}
      <label className="admin-check">
        <input
          type="checkbox"
          checked={listed}
          onChange={(e) => {
            setListed(e.target.checked);
            tool.touch();
          }}
        />
        {t(lang, "markets_listed_label")}
      </label>
      <ToolFooter
        lang={lang}
        tool={tool}
        confirmText={t(lang, "markets_confirm_switch", {
          country: name,
          signup: t(lang, signupOpen ? "markets_signup_open" : "markets_signup_closed"),
          listed: t(lang, listed ? "markets_listed" : "markets_hidden"),
        })}
        onConfirm={() => tool.run(() => adminSaveMarket({ code: m.code, signupOpen, listed, reason: tool.reason }))}
      />
      {!tool.reviewing && (
        <div className="toolbar">
          <button
            type="button"
            className="btn sm"
            disabled={unchanged}
            onClick={() => tool.review(() => (opening && !canOpen ? "admin_err_market_not_ready" : null))}
          >
            {t(lang, "admin_review")}
          </button>
        </div>
      )}
    </div>
  );
}

// One plan at a time. Empty boxes take the plan off sale in this country,
// which an open country refuses.
function PricesTool({ lang, market: m }: { lang: Lang; market: AdminMarket }) {
  const tool = useTool();
  const plans = m.prices.filter((p) => isPlanId(p.planId));
  const [planId, setPlanId] = useState(plans[0]?.planId ?? "basic");
  const current = plans.find((p) => p.planId === planId) ?? null;
  const [month, setMonth] = useState(current?.priceMonth == null ? "" : String(current.priceMonth));
  const [year, setYear] = useState(current?.priceYear == null ? "" : String(current.priceYear));
  const cur = currencyLabel(m.currency, lang);
  const pm = parsePriceInput(month);
  const py = parsePriceInput(year);

  function choose(id: string) {
    const p = plans.find((x) => x.planId === id) ?? null;
    setPlanId(id);
    setMonth(p?.priceMonth == null ? "" : String(p.priceMonth));
    setYear(p?.priceYear == null ? "" : String(p.priceYear));
    tool.touch();
  }

  const shown = (v: number | null) => (v === null ? "—" : formatPrice(v, m.currency, lang));

  return (
    <div className="admin-tool">
      <p className="at-tool-title">{t(lang, "markets_prices_title")}</p>
      <div className="ar-meta">
        {plans.map((p) => (
          <span key={p.planId}>
            {isPlanId(p.planId) ? planName(p.planId, lang) : p.planId}: {shown(p.priceMonth)} / {shown(p.priceYear)}
          </span>
        ))}
      </div>
      <div className="grid3">
        <div className="field">
          <label>{t(lang, "admin_plan")}</label>
          <select value={planId} onChange={(e) => choose(e.target.value)}>
            {plans.map((p) => (
              <option key={p.planId} value={p.planId}>
                {isPlanId(p.planId) ? planName(p.planId, lang) : p.planId}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t(lang, "markets_price_month", { cur })}</label>
          <input
            dir="ltr"
            inputMode="decimal"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              tool.touch();
            }}
          />
        </div>
        <div className="field">
          <label>{t(lang, "markets_price_year", { cur })}</label>
          <input
            dir="ltr"
            inputMode="decimal"
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              tool.touch();
            }}
          />
        </div>
      </div>
      <ToolFooter
        lang={lang}
        tool={tool}
        confirmText={
          pm === null && py === null
            ? t(lang, "markets_confirm_price_remove", { plan: isPlanId(planId) ? planName(planId, lang) : planId })
            : t(lang, "markets_confirm_price", {
                plan: isPlanId(planId) ? planName(planId, lang) : planId,
                month: pm == null ? "—" : formatPrice(pm, m.currency, lang),
                year: py == null ? "—" : formatPrice(py, m.currency, lang),
              })
        }
        onConfirm={() =>
          tool.run(() =>
            adminSavePlanPrice({
              planId,
              country: m.code,
              priceMonth: pm ?? null,
              priceYear: py ?? null,
              reason: tool.reason,
            })
          )
        }
      />
      {!tool.reviewing && (
        <div className="toolbar">
          <button
            type="button"
            className="btn sm"
            onClick={() =>
              tool.review(() => (pm === undefined || py === undefined || (pm === null) !== (py === null) ? "admin_err_price" : null))
            }
          >
            {t(lang, "admin_review")}
          </button>
        </div>
      )}
    </div>
  );
}

function OfferTool({ lang, market: m }: { lang: Lang; market: AdminMarket }) {
  const tool = useTool();
  const o = m.offer;
  const [price, setPrice] = useState(o ? String(o.pricePerDay) : "");
  const [slots, setSlots] = useState(o ? String(o.slotsPerDay) : "5");
  const [maxDays, setMaxDays] = useState(o ? String(o.maxDays) : "30");
  const [advance, setAdvance] = useState(o ? String(o.maxAdvanceDays) : "60");
  const [hold, setHold] = useState(o ? String(o.holdMinutes) : "30");
  const cur = currencyLabel(m.currency, lang);

  const values = {
    pricePerDay: Number(price),
    slotsPerDay: Number(slots),
    maxDays: Number(maxDays),
    maxAdvanceDays: Number(advance),
    holdMinutes: Number(hold),
  };
  const valid =
    Number.isFinite(values.pricePerDay) &&
    values.pricePerDay > 0 &&
    Number.isInteger(values.slotsPerDay) &&
    values.slotsPerDay >= 1 &&
    Number.isInteger(values.maxDays) &&
    values.maxDays >= 1 &&
    Number.isInteger(values.maxAdvanceDays) &&
    values.maxAdvanceDays >= 0 &&
    Number.isInteger(values.holdMinutes) &&
    values.holdMinutes >= 5;

  const input = (label: TKey, value: string, set: (v: string) => void, vars?: Record<string, string>) => (
    <div className="field">
      <label>{t(lang, label, vars)}</label>
      <input
        dir="ltr"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          set(e.target.value);
          tool.touch();
        }}
      />
    </div>
  );

  return (
    <div className="admin-tool">
      <p className="at-tool-title">{t(lang, "markets_offer_title")}</p>
      {!o && <p className="hint">{t(lang, "markets_offer_none")}</p>}
      <div className="grid3">
        {input("markets_offer_price", price, setPrice, { cur })}
        {input("markets_offer_slots", slots, setSlots)}
        {input("markets_offer_max_days", maxDays, setMaxDays)}
        {input("markets_offer_advance", advance, setAdvance)}
        {input("markets_offer_hold", hold, setHold)}
      </div>
      <ToolFooter
        lang={lang}
        tool={tool}
        confirmText={t(lang, "markets_confirm_offer", {
          price: valid ? formatPrice(values.pricePerDay, m.currency, lang) : "—",
          slots: String(values.slotsPerDay),
        })}
        onConfirm={() => tool.run(() => adminSaveOfferSettings({ country: m.code, ...values, reason: tool.reason }))}
      />
      {!tool.reviewing && (
        <div className="toolbar">
          <button type="button" className="btn sm" onClick={() => tool.review(() => (valid ? null : "admin_err_offer_settings"))}>
            {t(lang, "admin_review")}
          </button>
        </div>
      )}
    </div>
  );
}
