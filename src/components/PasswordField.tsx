"use client";

import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";

// Every password field in the app, with a way to read what you typed.
// Owner report (2026-09-20): "خيار اظهار كلمة المرور مش موجود" — on a phone
// keyboard, in a second language, a hidden field is where sign-ins go to
// die, and the app's own answer to a failed sign-in is deliberately vague
// ("invalid details"), so a typo is invisible twice over.
//
// A word, not an eye icon: the eye is ambiguous about which state it
// shows, and this app has no icon set. The button is type="button" so it
// never submits, and it carries aria-pressed so a screen reader announces
// the state rather than just the label.
export function PasswordField({
  lang,
  id,
  name = "password",
  autoComplete,
  minLength,
  required = true,
}: {
  lang: Lang;
  id: string;
  name?: string;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  required?: boolean;
}) {
  const [shown, setShown] = useState(false);

  return (
    <div className="pw-field">
      <input
        id={id}
        name={name}
        type={shown ? "text" : "password"}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="pw-toggle"
        aria-pressed={shown}
        aria-controls={id}
        onClick={() => setShown((v) => !v)}
      >
        {t(lang, shown ? "password_hide" : "password_show")}
      </button>
    </div>
  );
}
