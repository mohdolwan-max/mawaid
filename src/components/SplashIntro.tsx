"use client";

import { useEffect, useRef, useState } from "react";

// The installed app's opening (owner: "صفحة البداية اهم شي اول ما افتح
// التطبيق"). Launch goes: Android's native splash -> this overlay -> the
// app, and the handoff is meant to be invisible. So the overlay repeats the
// native splash exactly: the same #F7F6F2 ground and the same splash-symbol
// image at the same 210px, centred. Only then does it move. The Arabic
// wordmark rises in beneath and a soft ring pulses, then everything fades
// into the page.
//
// It is in the server HTML, so it is on screen from the page's first
// paint. When it waited for hydration, the page flashed between the native
// splash and the intro. Whether it shows at all is decided before paint by
// CSS (display-mode: standalone) and by the inline script in the root
// layout: once per session, and "#splash" in the URL forces a preview in
// any browser. In a normal browser tab it is display:none, and this
// component removes it on mount. The pictures are CSS backgrounds, not
// <img>: a browser downloads a hidden <img> anyway, which would cost every
// ordinary visitor the intro's images for a screen they never see.
export function SplashIntro() {
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || getComputedStyle(el).display === "none") {
      setGone(true);
      return;
    }
    // The preview holds until tapped, so it can actually be looked at.
    if (document.documentElement.classList.contains("splash-preview")) return;
    const leave = window.setTimeout(() => setLeaving(true), 1600);
    const end = window.setTimeout(() => setGone(true), 2050);
    return () => {
      window.clearTimeout(leave);
      window.clearTimeout(end);
    };
  }, []);

  if (gone) return null;

  return (
    <div
      ref={ref}
      className={`splash-intro${leaving ? " leaving" : ""}`}
      aria-hidden="true"
      onClick={() => {
        setLeaving(true);
        window.setTimeout(() => setGone(true), 450);
      }}
    >
      <div className="si-stage">
        <div className="si-pulse" />
        <div className="si-mark" />
        <div className="si-word" />
      </div>
    </div>
  );
}
