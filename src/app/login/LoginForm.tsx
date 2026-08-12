"use client";

import { useActionState } from "react";
import { login } from "./actions";
import { t, type Lang } from "@/lib/i18n";

export function LoginForm({ lang }: { lang: Lang }) {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <form action={formAction}>
      <div className="field">
        <label htmlFor="email">{t(lang, "email")}</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="password">{t(lang, "password")}</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      {state?.error && <p className="error-text">{t(lang, "auth_error")}</p>}
      <button type="submit" className="btn block" disabled={pending}>
        {pending ? t(lang, "loading") : t(lang, "login_cta")}
      </button>
    </form>
  );
}
