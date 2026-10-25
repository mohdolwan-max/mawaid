"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { formatPrice } from "@/lib/billing";
import {
  PACKAGE_NOTE_MAX,
  lastValidInstant,
  packagesForVisit,
  parseAmount,
  type CataloguePackage,
  type CustomerPackage,
} from "@/lib/packages";
import type { CustomerVisit } from "@/lib/customerFile";
import { cancelPackageAction, sellPackageAction, setVisitPackageAction } from "../actions";

const STATUS_CHIP: Record<CustomerPackage["status"], { key: TKey; tone: string }> = {
  active: { key: "pkg_status_active", tone: "good" },
  used_up: { key: "pkg_status_used_up", tone: "neutral" },
  expired: { key: "pkg_status_expired", tone: "warn" },
  cancelled: { key: "pkg_status_cancelled", tone: "bad" },
};

// The customer's packages, and selling a new one (0064). Selling is open to
// every member; cancelling a sale is the owner's (the database decides,
// the button only appears where it would succeed).
export function CustomerPackages({
  lang,
  phone,
  packages,
  catalogue,
  isOwner,
  currency,
  timezone,
}: {
  lang: Lang;
  phone: string;
  packages: CustomerPackage[];
  catalogue: CataloguePackage[];
  isOwner: boolean;
  currency: string;
  timezone: string;
}) {
  const router = useRouter();
  const locale = intlLocale(lang);
  const day = (d: Date | string) =>
    new Intl.DateTimeFormat(locale, { timeZone: timezone, dateStyle: "medium" }).format(typeof d === "string" ? new Date(d) : d);
  const money = (n: number) => formatPrice(n, currency, lang);
  const count = (n: number) => n.toLocaleString(locale);

  const [selling, setSelling] = useState(false);
  const [pick, setPick] = useState(catalogue[0]?.id ?? "");
  const picked = catalogue.find((c) => c.id === pick) ?? null;
  const [price, setPrice] = useState(picked ? String(picked.price) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [refund, setRefund] = useState("");

  function choose(id: string) {
    setPick(id);
    const c = catalogue.find((x) => x.id === id);
    // The price starts at the catalogue's; the desk may change it.
    setPrice(c ? String(c.price) : "");
  }

  async function sell() {
    const amount = parseAmount(price);
    if (!picked) return;
    if (amount === null) {
      setError("package_err_price");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await sellPackageAction(phone, picked.id, amount, note);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSelling(false);
    setNote("");
    router.refresh();
  }

  async function cancel(p: CustomerPackage) {
    const amount = parseAmount(refund, p.pricePaid);
    if (amount === null) {
      setError("package_err_refund");
      return;
    }
    if (!window.confirm(t(lang, "pkg_cancel_confirm", { name: p.name }))) return;
    setBusy(true);
    setError(null);
    const r = await cancelPackageAction(phone, p.id, amount);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setCancelling(null);
    setRefund("");
    router.refresh();
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="pkg-head">
        <p style={{ fontWeight: 700 }}>{t(lang, "pkg_title")}</p>
        {catalogue.length > 0 && !selling && (
          <button type="button" className="btn sm" onClick={() => setSelling(true)}>
            {t(lang, "pkg_sell")}
          </button>
        )}
      </div>

      {selling && picked && (
        <div className="pkg-sell">
          <div className="field">
            <label htmlFor="pkg-pick">{t(lang, "pkg_pick")}</label>
            <select id="pkg-pick" value={pick} onChange={(e) => choose(e.target.value)}>
              {catalogue.map((c) => (
                <option key={c.id} value={c.id}>
                  {t(lang, "pkg_option", { name: c.name, service: c.service, n: count(c.sessions), price: money(c.price) })}
                </option>
              ))}
            </select>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="pkg-price">{t(lang, "pkg_price_paid")}</label>
              <input
                id="pkg-price"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.001}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="pkg-note">{t(lang, "pkg_note")}</label>
              <input id="pkg-note" value={note} maxLength={PACKAGE_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <p className="hint">
            {picked.validityDays === null
              ? t(lang, "pkg_sell_hint_open")
              : t(lang, "pkg_sell_hint_days", { n: count(picked.validityDays) })}{" "}
            {t(lang, "pkg_sell_hint_today")}
          </p>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" disabled={busy} onClick={() => void sell()}>
              {busy ? t(lang, "loading") : t(lang, "pkg_sell_confirm")}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setSelling(false)}>
              {t(lang, "cancel")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="error-text">{t(lang, error)}</p>}

      {packages.length === 0 ? (
        <p className="hint" style={{ marginTop: 8 }}>
          {catalogue.length > 0 ? (
            t(lang, "pkg_none")
          ) : isOwner ? (
            <>
              {t(lang, "pkg_no_catalogue_owner")} <Link href="/services">{t(lang, "pkg_go_services")}</Link>
            </>
          ) : (
            t(lang, "pkg_no_catalogue")
          )}
        </p>
      ) : (
        <ul className="pkg-list">
          {packages.map((p) => {
            const last = lastValidInstant(p.expiresAt);
            const chip = STATUS_CHIP[p.status];
            return (
              <li key={p.id}>
                <div className="cv-top">
                  <strong>{p.name}</strong>
                  <span className={`chip ${chip.tone}`}>{t(lang, chip.key)}</span>
                </div>
                <div className="pkg-meter" aria-hidden="true">
                  <span style={{ width: `${p.sessionsTotal > 0 ? Math.min(100, (p.used / p.sessionsTotal) * 100) : 0}%` }} />
                </div>
                <p className="cv-what">
                  {t(lang, "pkg_used_of", { used: count(p.used), total: count(p.sessionsTotal), left: count(p.remaining) })}
                  {" · "}
                  {p.service}
                </p>
                <p className="hint">
                  {[
                    t(lang, "pkg_paid_on", { amount: money(p.pricePaid), d: p.soldAt ? day(p.soldAt) : "—" }),
                    p.soldBy ? t(lang, "pkg_sold_by", { name: p.soldBy }) : "",
                    last ? t(lang, "pkg_valid_until", { d: day(last) }) : t(lang, "pkg_no_expiry"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {p.note && <p className="cv-note">{p.note}</p>}
                {p.status === "cancelled" && p.cancelledAt && (
                  <p className="hint">
                    {t(lang, "pkg_cancelled_on", {
                      d: day(p.cancelledAt),
                      amount: money(p.refundAmount ?? 0),
                    })}
                  </p>
                )}
                {p.canCancel &&
                  (cancelling === p.id ? (
                    <div className="pkg-cancel">
                      <div className="field">
                        <label htmlFor={`refund-${p.id}`}>{t(lang, "pkg_refund")}</label>
                        <input
                          id={`refund-${p.id}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={p.pricePaid}
                          step={0.001}
                          value={refund}
                          placeholder="0"
                          onChange={(e) => setRefund(e.target.value)}
                        />
                      </div>
                      <p className="hint">{t(lang, "pkg_refund_hint", { max: money(p.pricePaid) })}</p>
                      <div className="toolbar">
                        <button type="button" className="btn danger sm" disabled={busy} onClick={() => void cancel(p)}>
                          {t(lang, "pkg_cancel_confirm_btn")}
                        </button>
                        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setCancelling(null)}>
                          {t(lang, "cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => {
                        setCancelling(p.id);
                        setRefund("");
                        setError(null);
                      }}
                    >
                      {t(lang, "pkg_cancel")}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// One finished visit's package: which package it drew on, or none. Only
// shown where there is something to choose (the customer has packages for
// this service, or the visit already carries one).
export function VisitPackage({
  lang,
  phone,
  visit,
  packages,
}: {
  lang: Lang;
  phone: string;
  visit: CustomerVisit;
  packages: CustomerPackage[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  if (visit.status !== "completed" && visit.status !== "no_show") return null;
  const options = packagesForVisit(visit, packages);
  if (options.length === 0 && !visit.packageId) return null;
  const NONE = "none";

  async function change(value: string) {
    setBusy(true);
    setError(null);
    const r = await setVisitPackageAction(phone, visit.id, value === NONE ? null : value);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="cv-pkg">
      <select
        value={visit.packageId ?? NONE}
        disabled={busy}
        aria-label={t(lang, "pkg_visit_label")}
        onChange={(e) => void change(e.target.value)}
      >
        <option value={NONE}>{t(lang, visit.packageOff ? "pkg_visit_off" : "pkg_visit_none")}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {t(lang, "pkg_visit_from", {
              name: p.name,
              left: p.remaining.toLocaleString(intlLocale(lang)),
            })}
          </option>
        ))}
      </select>
      {error && <p className="error-text">{t(lang, error)}</p>}
    </div>
  );
}
