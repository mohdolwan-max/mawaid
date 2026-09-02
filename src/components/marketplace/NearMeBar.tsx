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
export function NearMeBar({
  lang,
  hasGeo,
  hasResults,
}: {
  lang: Lang;
  hasGeo: boolean;
  /** Whether the nearest row actually rendered. Without this the bar
   *  said "showing the nearest to your location" above nothing whenever
   *  the row was empty — 0031 unapplied, or simply no clinic has set a
   *  location yet, which is the guaranteed launch state. */
  hasResults: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "asking" | "denied" | "unsupported">("idle");

  function locate() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState("unsupported");
      return;
    }
    setState("asking");

    // The Geolocation timeout clock EXCLUDES time spent on the browser's
    // permission prompt, and Firefox fires neither callback when the
    // prompt is dismissed with the X — leaving "asking" stuck forever
    // and the button dead until a reload. This timer is the ceiling on
    // the whole interaction, prompt included.
    let answered = false;
    const fallback = window.setTimeout(() => {
      if (!answered) {
        answered = true;
        setState("denied");
      }
    }, 25000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (answered) return;
        answered = true;
        window.clearTimeout(fallback);
        // Rounded to 3 decimals (~110m) BEFORE it leaves the device.
        // Ranking clinics needs the neighbourhood, not the doorstep, and
        // nothing finer is ever sent — let alone stored.
        const lat = pos.coords.latitude.toFixed(3);
        const lng = pos.coords.longitude.toFixed(3);
        document.cookie = `${GEO_COOKIE}=${lat},${lng}; path=/; max-age=86400; samesite=lax`;
        setState("idle");
        router.refresh();
      },
      () => {
        if (answered) return;
        answered = true;
        window.clearTimeout(fallback);
        setState("denied");
      },
      // A cached fix from the last five minutes is plenty for a list of
      // clinics; high accuracy would just burn battery warming up the GPS.
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  if (hasGeo) {
    return (
      <div className="near-bar">
        <span className="hint">{t(lang, hasResults ? "near_active" : "near_active_empty")}</span>
        <button type="button" className="btn ghost sm" disabled={state === "asking"} onClick={locate}>
          {state === "asking" ? t(lang, "loading") : t(lang, "near_refresh")}
        </button>
        {state === "denied" && <span className="error-text">{t(lang, "near_denied")}</span>}
        {state === "unsupported" && <span className="error-text">{t(lang, "near_unsupported")}</span>}
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
