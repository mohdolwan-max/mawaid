"use client";

import { useEffect, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { BrandMark } from "@/components/icons";

// "How would someone who doesn't know install this?" — the owner,
// installing it himself. Browsers bury Add-to-Home-Screen in a menu, so
// this banner surfaces it: one real tap on Android (the browser's own
// install dialog via beforeinstallprompt), spelled-out steps on iOS
// (Apple exposes no install API at all — instructions are the ceiling).
//
// Quiet by design: never in the installed app, never after a dismissal
// (14 days), and only on the home page — a floating banner over a
// booking wizard would cost more than it earns. `#install` previews the
// Android variant from any browser.
type Deferred = { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = "maw3ed_install_dismissed";
const DISMISS_DAYS = 14;

export function InstallPrompt({ lang }: { lang: Lang }) {
  const [mode, setMode] = useState<"hidden" | "android" | "ios">("hidden");
  const [deferred, setDeferred] = useState<Deferred | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const preview = window.location.hash === "#install";
    if (!preview) {
      try {
        const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
        if (at && Date.now() - at < DISMISS_DAYS * 86400_000) return;
      } catch {
        // Storage blocked: show it — worst case it reappears.
      }
    }

    if (preview) {
      setMode("android");
      return;
    }

    // iPadOS 13+ masquerades as macOS; those users are few enough that
    // missing them beats showing Mac users phone instructions.
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIOS) {
      setMode("ios");
      return;
    }

    const onPrompt = (e: Event) => {
      // The browser was about to show its own mini-infobar; deferring it
      // lets the visible button trigger the real install dialog instead.
      e.preventDefault();
      setDeferred(e as unknown as Deferred);
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (mode === "hidden") return null;

  function dismiss() {
    setMode("hidden");
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
  }

  async function install() {
    if (!deferred) {
      dismiss();
      return;
    }
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setMode("hidden");
    try {
      // Accepted: the standalone check hides this forever from the app
      // itself, and the browser won't re-fire the event once installed.
      // Declined at the NATIVE dialog is a strong no — quiet for 14 days.
      if (outcome !== "accepted") localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {}
  }

  return (
    <div className="install-prompt" role="dialog" aria-label={t(lang, "install_title")}>
      <BrandMark size={34} className="ip-mark" />
      <div className="ip-text">
        <strong>{t(lang, "install_title")}</strong>
        <span>{mode === "ios" ? t(lang, "install_ios_hint") : t(lang, "install_sub")}</span>
      </div>
      {mode === "android" && (
        <button type="button" className="btn sm" onClick={install}>
          {t(lang, "install_button")}
        </button>
      )}
      <button type="button" className="ip-close" aria-label={t(lang, "install_dismiss")} onClick={dismiss}>
        ✕
      </button>
    </div>
  );
}
