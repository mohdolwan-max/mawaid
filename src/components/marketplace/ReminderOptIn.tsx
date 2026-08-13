"use client";

import { useEffect, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { savePushSubscription } from "./reminderActions";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State = "unsupported" | "idle" | "working" | "enabled" | "denied";

// "Remind me 30 minutes before" opt-in. Guests pass the booking's
// cancelToken so the subscription ties to that appointment; signed-in
// customers are linked server-side via their account. On iPhone this
// only works after adding the site to the home screen (Apple limitation
// for all web apps) — we show a hint instead of the button there.
export function ReminderOptIn({ lang, cancelToken }: { lang: Lang; cancelToken: string | null }) {
  const [state, setState] = useState<State>("idle");
  const [needsInstall, setNeedsInstall] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      // iOS Safari outside an installed PWA has no PushManager.
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator && (navigator as unknown as { standalone?: boolean }).standalone === true);
      if (isIos && !standalone) setNeedsInstall(true);
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") setState("denied");
  }, []);

  if (state === "unsupported") {
    return needsInstall ? <p className="hint">{t(lang, "reminder_ios_hint")}</p> : null;
  }
  if (state === "denied") return null;

  if (state === "enabled") {
    return <p className="chip good">{t(lang, "reminder_enabled")}</p>;
  }

  return (
    <button
      type="button"
      className="btn ghost"
      disabled={state === "working"}
      onClick={async () => {
        setState("working");
        try {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            setState("denied");
            return;
          }
          const registration = await navigator.serviceWorker.register("/sw.js");
          await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
          });
          const json = subscription.toJSON();
          const ok = await savePushSubscription({
            endpoint: subscription.endpoint,
            p256dh: json.keys?.p256dh ?? "",
            auth: json.keys?.auth ?? "",
            cancelToken,
          });
          setState(ok ? "enabled" : "idle");
        } catch {
          setState("idle");
        }
      }}
    >
      {state === "working" ? t(lang, "loading") : t(lang, "reminder_cta")}
    </button>
  );
}
