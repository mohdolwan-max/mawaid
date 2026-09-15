"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { reasonOk } from "@/lib/admin";
import { formatPrice } from "@/lib/billing";
import {
  parseRate,
  registrationErrors,
  type RegistrationField,
  type RegistrationInput,
  type TaxRegistration,
  type UnassignedSales,
} from "@/lib/taxReport";
import { adminInvoiceUnassigned, adminSaveTaxRegistration } from "./actions";

const FIELD_ERROR: Record<RegistrationField, TKey> = {
  country: "tax_err_country",
  currency: "tax_err_currency",
  legalName: "tax_err_legal_name",
  taxNumber: "tax_err_tax_number",
  taxRate: "tax_err_rate",
  timezone: "tax_err_timezone",
  invoicePrefix: "tax_err_prefix",
};

const EMPTY: RegistrationInput = {
  country: "JO",
  currency: "JOD",
  legalName: "",
  taxNumber: "",
  address: "",
  taxRate: "",
  timezone: "Asia/Amman",
  invoicePrefix: "",
  active: true,
};

export function TaxClient({
  lang,
  registrations,
  unassigned,
}: {
  lang: Lang;
  registrations: TaxRegistration[];
  unassigned: UnassignedSales[];
}) {
  const [editing, setEditing] = useState<string | "new" | null>(registrations.length === 0 ? "new" : null);

  return (
    <div className="tax-regs">
      {unassigned.map((u) => (
        <UnassignedRow
          key={u.currency}
          lang={lang}
          sales={u}
          registration={registrations.find((r) => r.active && r.currency === u.currency) ?? null}
        />
      ))}

      {registrations.map((r) =>
        editing === r.id ? (
          <RegistrationForm key={r.id} lang={lang} registration={r} onClose={() => setEditing(null)} />
        ) : (
          <div key={r.id} className="card tax-reg">
            <div className="tax-reg-head">
              <strong>{r.legalName}</strong>
              <span className={`chip ${r.active ? "good" : "neutral"}`}>{t(lang, r.active ? "tax_active" : "tax_inactive")}</span>
            </div>
            <div className="ar-meta">
              <span>
                {r.country} · {r.currency}
              </span>
              <span>{t(lang, "tax_number_value", { n: r.taxNumber })}</span>
              <span>{t(lang, "tax_rate_value", { rate: r.taxRate.toLocaleString(intlLocale(lang)) })}</span>
              <span dir="ltr">{t(lang, "tax_next_invoice", { no: `${r.invoicePrefix}-${String(r.nextInvoiceNo).padStart(6, "0")}` })}</span>
              <span>{t(lang, "tax_invoices_count", { n: r.invoices.toLocaleString(intlLocale(lang)) })}</span>
              <span>{r.timezone}</span>
            </div>
            {r.address && <p className="hint">{r.address}</p>}
            <div className="toolbar">
              <button type="button" className="btn ghost sm" onClick={() => setEditing(r.id)}>
                {t(lang, "tax_edit")}
              </button>
            </div>
          </div>
        )
      )}

      {editing === "new" ? (
        <RegistrationForm lang={lang} registration={null} onClose={() => setEditing(null)} />
      ) : (
        <div>
          <button type="button" className="btn sm" onClick={() => setEditing("new")}>
            {t(lang, "tax_add")}
          </button>
        </div>
      )}
    </div>
  );
}

function RegistrationForm({
  lang,
  registration: r,
  onClose,
}: {
  lang: Lang;
  registration: TaxRegistration | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<RegistrationInput>(
    r
      ? {
          country: r.country,
          currency: r.currency,
          legalName: r.legalName,
          taxNumber: r.taxNumber,
          address: r.address ?? "",
          taxRate: String(r.taxRate),
          timezone: r.timezone,
          invoicePrefix: r.invoicePrefix,
          active: r.active,
        }
      : EMPTY
  );
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RegistrationField[]>([]);
  const [error, setError] = useState<TKey | null>(null);

  // Currency and prefix are fixed once invoices exist (0050).
  const locked = r !== null && r.invoices > 0;
  const rate = parseRate(values.taxRate);
  const rateChanged = r !== null && rate !== null && rate !== r.taxRate;

  function set<K extends keyof RegistrationInput>(key: K, value: RegistrationInput[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setReviewing(false);
  }

  function review() {
    const bad = registrationErrors(values);
    setFieldErrors(bad);
    if (bad.length > 0) return;
    if (!reasonOk(reason)) {
      setError("admin_err_reason");
      return;
    }
    setError(null);
    setReviewing(true);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await adminSaveTaxRegistration({ id: r?.id ?? null, values, reason });
      if (res.error) {
        setError(res.error);
        setReviewing(false);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  const field = (key: RegistrationField | "address", label: TKey, input: React.ReactNode, wide = false) => (
    <div className={`field${wide ? " wide" : ""}`}>
      <label>{t(lang, label)}</label>
      {input}
      {key !== "address" && fieldErrors.includes(key) && <p className="error-text">{t(lang, FIELD_ERROR[key])}</p>}
    </div>
  );

  return (
    <div className="card tax-reg">
      <strong>{t(lang, r ? "tax_edit_title" : "tax_add_title")}</strong>
      <div className="tax-form">
        {field("legalName", "tax_legal_name", <input value={values.legalName} onChange={(e) => set("legalName", e.target.value)} />, true)}
        {field("taxNumber", "tax_tax_number", <input dir="ltr" value={values.taxNumber} onChange={(e) => set("taxNumber", e.target.value)} />)}
        {field(
          "taxRate",
          "tax_rate",
          <input dir="ltr" inputMode="decimal" placeholder="16" value={values.taxRate} onChange={(e) => set("taxRate", e.target.value)} />
        )}
        {field(
          "country",
          "tax_country",
          <input dir="ltr" maxLength={2} placeholder="JO" value={values.country} onChange={(e) => set("country", e.target.value.toUpperCase())} />
        )}
        {field(
          "currency",
          "tax_currency",
          <input
            dir="ltr"
            maxLength={3}
            placeholder="JOD"
            disabled={locked}
            value={values.currency}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
          />
        )}
        {field(
          "invoicePrefix",
          "tax_prefix",
          <input
            dir="ltr"
            maxLength={10}
            placeholder="JO"
            disabled={locked}
            value={values.invoicePrefix}
            onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())}
          />
        )}
        {field("timezone", "tax_timezone", <input dir="ltr" value={values.timezone} onChange={(e) => set("timezone", e.target.value)} />)}
        {field("address", "tax_address", <input value={values.address} onChange={(e) => set("address", e.target.value)} />, true)}
      </div>
      {locked && <p className="hint">{t(lang, "tax_locked_hint")}</p>}
      <label className="admin-check">
        <input type="checkbox" checked={values.active} onChange={(e) => set("active", e.target.checked)} />
        {t(lang, "tax_active_label")}
      </label>
      <div className="field">
        <label>{t(lang, "admin_reason")}</label>
        <input
          value={reason}
          placeholder={t(lang, "tax_reason_ph")}
          onChange={(e) => {
            setReason(e.target.value);
            setReviewing(false);
          }}
        />
      </div>
      {reviewing && (
        <p className="admin-confirm">
          {t(lang, "tax_confirm", {
            name: values.legalName.trim(),
            currency: values.currency.trim().toUpperCase(),
            rate: rate === null ? "—" : rate.toLocaleString(intlLocale(lang)),
          })}
          {rateChanged && ` ${t(lang, "tax_rate_change_note")}`}
        </p>
      )}
      {error && <p className="error-text">{t(lang, error)}</p>}
      <div className="toolbar">
        {!reviewing ? (
          <button type="button" className="btn sm" onClick={review}>
            {t(lang, "admin_review")}
          </button>
        ) : (
          <button type="button" className="btn sm" disabled={pending} onClick={save}>
            {t(lang, "admin_confirm")}
          </button>
        )}
        <button type="button" className="btn ghost sm" disabled={pending} onClick={onClose}>
          {t(lang, "cancel")}
        </button>
      </div>
    </div>
  );
}

function UnassignedRow({
  lang,
  sales,
  registration,
}: {
  lang: Lang;
  sales: UnassignedSales;
  registration: TaxRegistration | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

  function apply() {
    setError(null);
    startTransition(async () => {
      const res = await adminInvoiceUnassigned({ currency: sales.currency, reason });
      if (res.error) {
        setError(res.error);
        setReviewing(false);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="card tax-reg">
      <p className="offer-notice">
        {t(lang, "tax_unassigned", {
          n: sales.count.toLocaleString(intlLocale(lang)),
          amount: formatPrice(sales.amount, sales.currency, lang),
          currency: sales.currency,
        })}
      </p>
      {!registration ? (
        <p className="hint">{t(lang, "tax_unassigned_needs_reg", { currency: sales.currency })}</p>
      ) : !open ? (
        <div className="toolbar">
          <button type="button" className="btn sm" onClick={() => setOpen(true)}>
            {t(lang, "tax_invoice_them")}
          </button>
        </div>
      ) : (
        <div className="admin-tool">
          <div className="field">
            <label>{t(lang, "admin_reason")}</label>
            <input
              value={reason}
              placeholder={t(lang, "tax_invoice_reason_ph")}
              onChange={(e) => {
                setReason(e.target.value);
                setReviewing(false);
              }}
            />
          </div>
          {reviewing && (
            <p className="admin-confirm">
              {t(lang, "tax_confirm_invoice", {
                n: sales.count.toLocaleString(intlLocale(lang)),
                name: registration.legalName,
                rate: registration.taxRate.toLocaleString(intlLocale(lang)),
                no: `${registration.invoicePrefix}-${String(registration.nextInvoiceNo).padStart(6, "0")}`,
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
  );
}
