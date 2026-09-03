"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/icons";

// The animated opening the installed app shows the moment it launches.
//
// Android's own splash (background colour + icon + name, composed from
// the manifest) CANNOT be animated or resized — no web API touches it.
// What can be owned is the first frame after it: this overlay renders
// the mark large with a soft pulse for ~1.5s, then fades into the app.
// Owner's ask, verbatim: "اول صفحة بس افتح التطبيق و تكون دايناميك
// و كبيرة و متحركة".
//
// Standalone-only: in a browser tab a splash is just an obstacle — the
// marketplace's own no-motion rule stands there. Opening the INSTALLED
// app is the one moment motion is expected. `#splash` in the URL forces
// a preview from any browser (how this gets reviewed without a phone).
export function SplashIntro() {
  const [phase, setPhase] = useState<"hidden" | "showing" | "leaving">("hidden");

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const preview = window.location.hash === "#splash";
    if (!standalone && !preview) return;
    // Once per session: a soft client-side navigation or reload while
    // using the app must not replay the intro — only a fresh launch.
    try {
      if (sessionStorage.getItem("maw3ed_splash") && !preview) return;
      sessionStorage.setItem("maw3ed_splash", "1");
    } catch {
      // Storage blocked: still show it — worst case a reload replays.
    }
    setPhase("showing");
    // Preview holds until tapped (tapping plays the exit fade) so a
    // human — or a screenshot taken seconds later — can actually look
    // at it; the real launch stays snappy and dismisses itself.
    if (preview) return;
    const leave = window.setTimeout(() => setPhase("leaving"), 1500);
    const gone = window.setTimeout(() => setPhase("hidden"), 1950);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(gone);
    };
  }, []);

  if (phase === "hidden") return null;

  return (
    <div
      className={`splash-intro${phase === "leaving" ? " leaving" : ""}`}
      aria-hidden="true"
      onClick={() => {
        setPhase("leaving");
        window.setTimeout(() => setPhase("hidden"), 450);
      }}
    >
      <div className="si-pulse" />
      <BrandMark size={220} className="si-mark" />
    </div>
  );
}
