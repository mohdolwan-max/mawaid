"use client";

import { useActionState } from "react";
import { requestPasswordReset } from "./actions";
import { t, type Lang } from "@/lib/i18n";

export function ForgotPasswordForm({ lang, next }: { lang: Lang; next: string }) {
  const [state, formAction, pending] = useActionState(requestPasswordReset, undefined);

  if (state?.sent) {
    return <p className="hint">{t(lang, "reset_email_sent")}</p>;
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">{t(lang, "email")}</label>
        <input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      {state?.error && <p className="error-text">{t(lang, "auth_error")}</p>}
      <button type="submit" className="btn block" disabled={pending}>
        {pending ? t(lang, "sending_reset_link") : t(lang, "send_reset_link")}
      </button>
    </form>
  );
}
