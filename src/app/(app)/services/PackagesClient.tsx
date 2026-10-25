"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { formatPrice } from "@/lib/billing";
import type { Service } from "@/lib/types";
import {
  PACKAGE_NAME_MAX,
  PACKAGE_SESSIONS_MAX,
  PACKAGE_SESSIONS_MIN,
  PACKAGE_VALIDITY_MAX,
  perSessionValue,
  type CataloguePackage,
} from "@/lib/packages";
import { deletePackageAction, savePackageAction, setPackageActiveAction } from "./actions";

type Draft = { serviceId: string; name: string; sessions: string; price: string; validityDays: string };

const fromPackage = (p: CataloguePackage): Draft => ({
  serviceId: p.serviceId,
  name: p.name,
  sessions: String(p.sessions),
  price: String(p.price),
  validityDays: p.validityDays === null ? "" : String(p.validityDays),
});

// The clinic's session packages (0064): what it offers, sold from the
// customer file. Editing a package changes future sales only; a package
// that was ever sold is retired rather than deleted.
export function PackagesClient({
  lang,
  packages,
  services,
  canManage,
  currency,
}: {
  lang: Lang;
  /** null = could not be read; the section says so instead of "none". */
  packages: CataloguePackage[] | null;
  services: Service[];
  canManage: boolean;
  currency: string;
}) {
  const router = useRouter();
  const locale = intlLocale(lang);
  const money = (n: number) => formatPrice(n, currency, lang);
  const count = (n: number) => n.toLocaleString(locale);
  const blank: Draft = { serviceId: services[0]?.id ?? "", name: "", sessions: "6", price: "", validityDays: "" };
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [notice, setNotice] = useState<TKey | null>(null);

  function open(target: CataloguePackage | null) {
    setDraft(target ? fromPackage(target) : blank);
    setEditing(target ? target.id : "new");
    setError(null);
    setNotice(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await savePackageAction(editing === "new" ? null : editing, draft);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEditing(null);
    router.refresh();
  }

  async function toggle(p: CataloguePackage) {
    setNotice(null);
    const r = await setPackageActiveAction(p.id, !p.active);
    if (!r.ok) setError("error_generic");
    router.refresh();
  }

  async function remove(p: CataloguePackage) {
    if (!window.confirm(t(lang, p.sold > 0 ? "pkgcat_confirm_retire" : "pkgcat_confirm_delete", { name: p.name }))) return;
    setNotice(null);
    const r = await deletePackageAction(p.id);
    if (!r.ok) {
      setError("error_generic");
      return;
    }
    if (r.outcome === "archived") setNotice("pkgcat_retired");
    router.refresh();
  }

  const per = perSessionValue(Number(draft.price), Number(draft.sessions));

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="pkg-head">
        <div>
          <p style={{ fontWeight: 700 }}>{t(lang, "pkgcat_title")}</p>
          <p className="hint">{t(lang, "pkgcat_sub")}</p>
        </div>
        {canManage && packages !== null && services.length > 0 && editing === null && (
          <button type="button" className="btn sm" onClick={() => open(null)}>
            {t(lang, "pkgcat_add")}
          </button>
        )}
      </div>

      {editing !== null && (
        <div className="pkg-sell">
          <div className="grid2">
            <div className="field">
              <label htmlFor="pkgcat-service">{t(lang, "pkgcat_service")}</label>
              <select
                id="pkgcat-service"
                value={draft.serviceId}
                onChange={(e) => setDraft({ ...draft, serviceId: e.target.value })}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pkgcat-name">{t(lang, "pkgcat_name")}</label>
              <input
                id="pkgcat-name"
                value={draft.name}
                maxLength={PACKAGE_NAME_MAX}
                placeholder={t(lang, "pkgcat_name_ph")}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
          </div>
          <div className="grid3">
            <div className="field">
              <label htmlFor="pkgcat-sessions">{t(lang, "pkgcat_sessions")}</label>
              <input
                id="pkgcat-sessions"
                type="number"
                inputMode="numeric"
                min={PACKAGE_SESSIONS_MIN}
                max={PACKAGE_SESSIONS_MAX}
                step={1}
                value={draft.sessions}
                onChange={(e) => setDraft({ ...draft, sessions: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="pkgcat-price">{t(lang, "pkgcat_price")}</label>
              <input
                id="pkgcat-price"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.001}
                value={draft.price}
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="pkgcat-days">{t(lang, "pkgcat_validity")}</label>
              <input
                id="pkgcat-days"
                type="number"
                inputMode="numeric"
                min={1}
                max={PACKAGE_VALIDITY_MAX}
                step={1}
                value={draft.validityDays}
                placeholder={t(lang, "pkgcat_validity_ph")}
                onChange={(e) => setDraft({ ...draft, validityDays: e.target.value })}
              />
            </div>
          </div>
          <p className="hint">
            {per !== null && draft.price.trim() !== "" ? t(lang, "pkgcat_per_session", { amount: money(per) }) + " " : ""}
            {t(lang, editing === "new" ? "pkgcat_hint_new" : "pkgcat_hint_edit")}
          </p>
          {error && <p className="error-text">{t(lang, error)}</p>}
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" disabled={busy} onClick={() => void save()}>
              {busy ? t(lang, "loading") : t(lang, "save")}
            </button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setEditing(null)}>
              {t(lang, "cancel")}
            </button>
          </div>
        </div>
      )}

      {editing === null && error && <p className="error-text">{t(lang, error)}</p>}
      {notice && <p className="hint" style={{ color: "var(--good-ink)" }}>{t(lang, notice)}</p>}

      {packages === null ? (
        <p className="error-text">{t(lang, "error_generic")}</p>
      ) : packages.length === 0 ? (
        <p className="hint" style={{ marginTop: 8 }}>
          {services.length === 0 ? t(lang, "pkgcat_need_service") : t(lang, "pkgcat_empty")}
        </p>
      ) : (
        <ul className="pkg-list">
          {packages.map((p) => (
            <li key={p.id}>
              <div className="cv-top">
                <strong>{p.name}</strong>
                <span className={`chip ${p.active ? "good" : "neutral"}`}>{t(lang, p.active ? "active" : "inactive")}</span>
              </div>
              <p className="cv-what">
                {[
                  p.service,
                  t(lang, "pkgcat_sessions_n", { n: count(p.sessions) }),
                  money(p.price),
                  p.validityDays === null ? t(lang, "pkg_no_expiry") : t(lang, "pkgcat_valid_days", { n: count(p.validityDays) }),
                ].join(" · ")}
              </p>
              <p className="hint">{t(lang, "pkgcat_sold_n", { n: count(p.sold) })}</p>
              {canManage && (
                <div className="toolbar" style={{ marginTop: 6 }}>
                  <button type="button" className="btn ghost sm" onClick={() => open(p)}>
                    {t(lang, "edit")}
                  </button>
                  <button type="button" className="btn ghost sm" onClick={() => void toggle(p)}>
                    {t(lang, p.active ? "pkgcat_stop" : "pkgcat_resume")}
                  </button>
                  <button type="button" className="btn danger sm" onClick={() => void remove(p)}>
                    {t(lang, "delete")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
