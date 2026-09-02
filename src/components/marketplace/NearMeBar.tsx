"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang } from "@/lib/i18n";
import { GEO_COOKIE } from "@/lib/directory";

// Asks the browser for the customer's position and stores it — rounded —
// so the server can render the "الأقرب إليك" row. Everything about this
// is opt-in: no permission prompt fires until the button is pressed,
// because a permission dialog on page load is the fastest way to get a
// permanent "Block".
export function NearMeBar({ lang, hasGeo }: { lang: Lang; hasGeo: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "asking" | "denied" | "unsupported">("idle");

  function locate() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState("unsupported");
      return;
    }
    setState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Rounded to 3 decimals (~110m) BEFORE it leaves the device.
        // Ranking clinics needs the neighbourhood, not the doorstep, and
        // the server never sees — let alone stores — anything finer.
        // The cookie lives on the customer's own phone for a day.
        const lat = pos.coords.latitude.toFixed(3);
        const lng = pos.coords.longitude.toFixed(3);
        document.cookie = `${GEO_COOKIE}=${lat},${lng}; path=/; max-age=86400; samesite=lax`;
        setState("idle");
        router.refresh();
      },
      () => setState("denied"),
      // A cached fix from the last five minutes is plenty for a list of
      // clinics; high accuracy would just burn battery warming up the GPS.
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  if (hasGeo) {
    return (
      <div className="near-bar">
        <span className="hint">{t(lang, "near_active")}</span>
        <button type="button" className="btn ghost sm" disabled={state === "asking"} onClick={locate}>
          {t(lang, "near_refresh")}
        </button>
      </div>
    );
  }

  return (
    <div className="near-bar">
      <span className="hint">{t(lang, "near_hint")}</span>
      <button type="button" className="btn sm" disabled={state === "asking"} onClick={locate}>
        {state === "asking" ? t(lang, "loading") : t(lang, "near_enable")}
      </button>
      {state === "denied" && <span className="error-text">{t(lang, "near_denied")}</span>}
      {state === "unsupported" && <span className="error-text">{t(lang, "near_unsupported")}</span>}
    </div>
  );
}
