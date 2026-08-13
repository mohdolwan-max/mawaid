"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang } from "@/lib/i18n";
import { cancelAction } from "@/app/[orgSlug]/booking/[token]/actions";

export function CancelMyBooking({ lang, token }: { lang: Lang; token: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  return (
    <button
      className="btn danger sm"
      disabled={pending}
      onClick={async () => {
        if (!confirm(t(lang, "booking_cancel_confirm"))) return;
        setPending(true);
        await cancelAction(token);
        router.refresh();
      }}
    >
      {t(lang, "cancel")}
    </button>
  );
}
