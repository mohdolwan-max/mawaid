"use client";

import { useEffect } from "react";

// Registers sw.js on every load, not only when a customer opts into
// reminders (ReminderOptIn.tsx does that too — a second .register() call
// for the same URL is a no-op, the browser reuses the live registration).
// The offline fallback it installs (see sw.js) needs to be in place
// BEFORE the connection drops, which means it needs registering on a
// normal visit, not deferred until the customer taps something.
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Best-effort: a browser tab works fine without it, only the
      // installed app's offline screen is what's lost.
    });
  }, []);

  return null;
}
