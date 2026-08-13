"use client";

import { useActionState, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import type { CustomerProfile } from "@/lib/customer";
import { customerLogin, customerSignup, updateCustomerProfile } from "./actions";

export function AccountClient({
  lang,
  profile,
  next,
}: {
  lang: Lang;
  profile: CustomerProfile | null;
  next: string | null;
}) {
  if (profile) {
    return <ProfileCard lang={lang} profile={profile} />;
  }
  return <AuthTabs lang={lang} next={next} />;
}

function AuthTabs({ lang, next }: { lang: Lang; next: string | null }) {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [loginState, loginAction, loginPending] = useActionState(customerLogin, undefined);
  const [signupState, signupAction, signupPending] = useActionState(customerSignup, undefined);

  if (signupState?.needsEmailConfirm) {
    return <p>{t(lang, "cust_check_email")}</p>;
  }

  return (
    <div>
      <h1 style={{ color: "var(--brand)", fontSize: 20, fontWeight: 800, marginBottom: 4 }}>
        {t(lang, "cust_account_title")}
      </h1>
      <p className="sub" style={{ marginBottom: 14 }}>{t(lang, "cust_signup_hint")}</p>

      <div className="toolbar" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`btn ${tab === "login" ? "" : "ghost"}`}
          onClick={() => setTab("login")}
        >
          {t(lang, "cust_login_tab")}
        </button>
        <button
          type="button"
          className={`btn ${tab === "signup" ? "" : "ghost"}`}
          onClick={() => setTab("signup")}
        >
          {t(lang, "cust_signup_tab")}
        </button>
      </div>

      {tab === "login" ? (
        <form action={loginAction}>
          <input type="hidden" name="next" value={next ?? ""} />
          <div className="field">
            <label htmlFor="cl_email">{t(lang, "email")}</label>
            <input id="cl_email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="cl_password">{t(lang, "password")}</label>
            <input id="cl_password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {loginState?.error && <p className="error-text">{t(lang, "auth_error")}</p>}
          <button type="submit" className="btn block" disabled={loginPending}>
            {loginPending ? t(lang, "loading") : t(lang, "cust_login_tab")}
          </button>
        </form>
      ) : (
        <form action={signupAction}>
          <input type="hidden" name="next" value={next ?? ""} />
          <div className="grid2">
            <div className="field">
              <label htmlFor="cs_name">{t(lang, "cust_name")}</label>
              <input id="cs_name" name="name" required autoComplete="name" />
            </div>
            <div className="field">
              <label htmlFor="cs_phone">{t(lang, "cust_phone")}</label>
              <input id="cs_phone" name="phone" dir="ltr" required autoComplete="tel" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="cs_email">{t(lang, "email")}</label>
            <input id="cs_email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="cs_password">{t(lang, "password")}</label>
            <input id="cs_password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          </div>
          {signupState?.error && <p className="error-text">{signupState.error}</p>}
          <button type="submit" className="btn block" disabled={signupPending}>
            {signupPending ? t(lang, "loading") : t(lang, "cust_signup_tab")}
          </button>
        </form>
      )}
    </div>
  );
}

function ProfileCard({ lang, profile }: { lang: Lang; profile: CustomerProfile }) {
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div>
      <h1 style={{ color: "var(--brand)", fontSize: 20, fontWeight: 800, marginBottom: 14 }}>
        {t(lang, "cust_account_title")}
      </h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await updateCustomerProfile({ name, phone });
          setSaving(false);
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        }}
      >
        <div className="field">
          <label htmlFor="cp_email">{t(lang, "email")}</label>
          <input id="cp_email" value={profile.email ?? ""} readOnly disabled dir="ltr" />
        </div>
        <div className="field">
          <label htmlFor="cp_name">{t(lang, "cust_name")}</label>
          <input id="cp_name" value={name} required onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cp_phone">{t(lang, "cust_phone")}</label>
          <input id="cp_phone" dir="ltr" value={phone} required onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="toolbar">
          <button type="submit" className="btn" disabled={saving}>
            {saving ? t(lang, "loading") : saved ? t(lang, "cust_profile_saved") : t(lang, "save")}
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional full navigation to a Route Handler (GET /auth/signout), not an app route */}
          <a href="/auth/signout" className="btn ghost">
            {t(lang, "signout")}
          </a>
        </div>
      </form>
    </div>
  );
}
