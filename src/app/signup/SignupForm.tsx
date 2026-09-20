"use client";

import { useActionState } from "react";
import { signup } from "./actions";
import { t, type Lang } from "@/lib/i18n";
import { PasswordField } from "@/components/PasswordField";

export function SignupForm({ lang }: { lang: Lang }) {
  const [state, formAction, pending] = useActionState(signup, undefined);

  if (state?.needsEmailConfirm) {
    return <p>{t(lang, "signup_check_email")}</p>;
  }

  return (
    <form action={formAction}>
      <div className="field">
        <label htmlFor="email">{t(lang, "email")}</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="password">{t(lang, "password")}</label>
        <PasswordField lang={lang} id="password" autoComplete="new-password" minLength={8} />
      </div>
      {state?.error && <p className="error-text">{t(lang, state.error)}</p>}
      <button type="submit" className="btn block" disabled={pending}>
        {pending ? t(lang, "loading") : t(lang, "signup_cta")}
      </button>
    </form>
  );
}
