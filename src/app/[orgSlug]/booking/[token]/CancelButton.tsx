"use client";

import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { cancelAction } from "./actions";

export function CancelButton({ lang, token }: { lang: Lang; token: string }) {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return <p className="chip bad">{t(lang, "booking_cancelled")}</p>;
  }

  return (
    <button
      className="btn danger"
      disabled={pending}
      onClick={async () => {
        if (!confirm(t(lang, "booking_cancel_confirm"))) return;
        setPending(true);
        await cancelAction(token);
        setPending(false);
        setDone(true);
      }}
    >
      {t(lang, "booking_cancel_cta")}
    </button>
  );
}
