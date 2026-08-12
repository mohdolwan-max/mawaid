"use client";

import { useActionState } from "react";
import { signup } from "./actions";
import { t, type Lang } from "@/lib/i18n";

export function SignupForm({ lang }: { lang: Lang }) {
  const [state, formAction, pending] = useActionState(signup, undefined);

  if (state?.needsEmailConfirm) {
    return <p>{lang === "ar" ? "تحقق من بريدك الإلكتروني لتأكيد الحساب." : "Check your email to confirm your account."}</p>;
  }

  return (
    <form action={formAction}>
      <div className="field">
        <label htmlFor="email">{t(lang, "email")}</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="password">{t(lang, "password")}</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      {state?.error && <p className="error-text">{state.error}</p>}
      <button type="submit" className="btn block" disabled={pending}>
        {pending ? t(lang, "loading") : t(lang, "signup_cta")}
      </button>
    </form>
  );
}
