"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang } from "@/lib/i18n";
import { cancelAction } from "./actions";

export function CancelButton({ lang, token }: { lang: Lang; token: string }) {
  const router = useRouter();
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
        // Without this the page still said "booked" beside the message
        // saying it had been cancelled, until the visitor reloaded.
        router.refresh();
      }}
    >
      {t(lang, "booking_cancel_cta")}
    </button>
  );
}
