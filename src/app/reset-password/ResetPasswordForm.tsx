"use client";

import Link from "next/link";
import { useActionState } from "react";
import { updatePassword } from "./actions";
import { t, type Lang } from "@/lib/i18n";
import { PasswordField } from "@/components/PasswordField";

export function ResetPasswordForm({ lang, next }: { lang: Lang; next: string }) {
  const [state, formAction, pending] = useActionState(updatePassword, undefined);

  if (state?.done) {
    return (
      <>
        <p className="hint">{t(lang, "reset_password_success")}</p>
        <p className="hint" style={{ marginTop: 14 }}>
          <Link href={next}>{t(lang, "back_to_login")}</Link>
        </p>
      </>
    );
  }

  return (
    <form action={formAction}>
      <div className="field">
        <label htmlFor="password">{t(lang, "new_password")}</label>
        <PasswordField lang={lang} id="password" autoComplete="new-password" minLength={8} />
      </div>
      {state?.error && <p className="error-text">{t(lang, "reset_password_error")}</p>}
      <button type="submit" className="btn block" disabled={pending}>
        {pending ? t(lang, "loading") : t(lang, "reset_password_cta")}
      </button>
    </form>
  );
}
