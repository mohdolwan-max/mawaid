"use client";

import { useState } from "react";
import { t, type Lang, type TKey } from "@/lib/i18n";
import type { BusinessHours } from "@/lib/types";
import { CATEGORIES, CITIES } from "@/lib/directory";
import { createOrgAction, saveHoursAction, finishOnboardingAction } from "./actions";

const DEFAULT_HOURS: BusinessHours = {
  "0": { open: "09:00", close: "21:00", closed: false },
  "1": { open: "09:00", close: "21:00", closed: false },
  "2": { open: "09:00", close: "21:00", closed: false },
  "3": { open: "09:00", close: "21:00", closed: false },
  "4": { open: "09:00", close: "21:00", closed: false },
  "5": { open: "09:00", close: "21:00", closed: true },
  "6": { open: "09:00", close: "21:00", closed: false },
};

const DAY_KEYS = ["day_sun", "day_mon", "day_tue", "day_wed", "day_thu", "day_fri", "day_sat"] as const;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function OnboardingWizard({
  lang,
  existingOrgId,
  existingBusinessHours,
}: {
  lang: Lang;
  existingOrgId: string | null;
  existingBusinessHours: BusinessHours | null;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(existingOrgId ? 2 : 1);
  const [orgId, setOrgId] = useState<string | null>(existingOrgId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // step 1
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("");
  const [city, setCity] = useState("");

  // step 2
  const [hours, setHours] = useState<BusinessHours>(existingBusinessHours ?? DEFAULT_HOURS);

  // step 3
  const [svcName, setSvcName] = useState("");
  const [svcDuration, setSvcDuration] = useState(30);
  const [svcPrice, setSvcPrice] = useState("");

  async function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await createOrgAction({ name, slug, address, phone, category, city });
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setOrgId(result.orgId);
    setStep(2);
  }

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setPending(true);
    setError(null);
    const result = await saveHoursAction(orgId, hours);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setStep(3);
  }

  async function handleStep3(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setPending(true);
    setError(null);
    const result = await finishOnboardingAction(orgId, {
      name: svcName,
      duration: svcDuration,
      price: svcPrice === "" ? null : Number(svcPrice),
    });
    // finishOnboardingAction redirects on success, so reaching here means
    // it returned an error object instead of navigating away.
    setPending(false);
    if (result && "error" in result) {
      setError(result.error);
    }
  }

  return (
    <div className="auth-card card" style={{ maxWidth: 520 }}>
      <h1>{t(lang, "onboarding_title")}</h1>
      <p className="sub">{t(lang, "onboarding_step", { n: step })}</p>

      {step === 1 && (
        <form onSubmit={handleStep1}>
          <div className="field">
            <label htmlFor="org_name">{t(lang, "org_name")}</label>
            <input
              id="org_name"
              value={name}
              required
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="org_slug">{t(lang, "org_slug")}</label>
            <input
              id="org_slug"
              value={slug}
              required
              dir="ltr"
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
            />
            <p className="hint">{t(lang, "org_slug_hint", { slug: slug || "..." })}</p>
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="org_category">{t(lang, "dir_category")}</label>
              <select id="org_category" required value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{t(lang, "choose_option")}</option>
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c[lang]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="org_city">{t(lang, "dir_city")}</label>
              <select id="org_city" required value={city} onChange={(e) => setCity(e.target.value)}>
                <option value="">{t(lang, "choose_option")}</option>
                {CITIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c[lang]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="org_address">{t(lang, "org_address")}</label>
            <input id="org_address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="org_phone">{t(lang, "org_phone")}</label>
            <input id="org_phone" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          {error && <p className="error-text">{t(lang, error as TKey)}</p>}
          <button type="submit" className="btn block" disabled={pending}>
            {pending ? t(lang, "loading") : t(lang, "next")}
          </button>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={handleStep2}>
          <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "business_hours_title")}</p>
          {DAY_KEYS.map((dayKey, idx) => {
            const key = String(idx);
            const day = hours[key];
            return (
              <div key={key} className="field" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 90, fontSize: 12.5, fontWeight: 600 }}>{t(lang, dayKey)}</span>
                <label style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={!day.closed}
                    onChange={(e) =>
                      setHours({ ...hours, [key]: { ...day, closed: !e.target.checked } })
                    }
                  />
                  {t(lang, "open")}
                </label>
                {!day.closed && (
                  <>
                    <input
                      type="time"
                      dir="ltr"
                      value={day.open}
                      onChange={(e) => setHours({ ...hours, [key]: { ...day, open: e.target.value } })}
                    />
                    <input
                      type="time"
                      dir="ltr"
                      value={day.close}
                      onChange={(e) => setHours({ ...hours, [key]: { ...day, close: e.target.value } })}
                    />
                  </>
                )}
              </div>
            );
          })}
          {error && <p className="error-text">{t(lang, error as TKey)}</p>}
          <button type="submit" className="btn block" disabled={pending}>
            {pending ? t(lang, "loading") : t(lang, "next")}
          </button>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={handleStep3}>
          <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "first_service_title")}</p>
          <div className="field">
            <label htmlFor="svc_name">{t(lang, "service_name")}</label>
            <input id="svc_name" value={svcName} required onChange={(e) => setSvcName(e.target.value)} />
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="svc_duration">{t(lang, "service_duration")}</label>
              <input
                id="svc_duration"
                type="number"
                min={5}
                step={5}
                required
                value={svcDuration}
                onChange={(e) => setSvcDuration(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label htmlFor="svc_price">{t(lang, "service_price")}</label>
              <input
                id="svc_price"
                type="number"
                min={0}
                step={0.01}
                value={svcPrice}
                onChange={(e) => setSvcPrice(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="error-text">{t(lang, error as TKey)}</p>}
          <button type="submit" className="btn block" disabled={pending}>
            {pending ? t(lang, "loading") : t(lang, "onboarding_finish")}
          </button>
        </form>
      )}
    </div>
  );
}
