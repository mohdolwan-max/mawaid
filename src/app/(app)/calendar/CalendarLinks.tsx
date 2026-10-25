"use client";

import { useState } from "react";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { canonicalSiteUrl } from "@/lib/siteUrl";
import { calendarFeedAction } from "./actions";

type Scope = "me" | "clinic";

// "Add to my calendar" (0070): a private link Google Calendar, the iPhone
// calendar or Outlook subscribe to. Folded by default; the link is only
// fetched (and created) when asked for.
export function CalendarLinks({ lang, isOwner }: { lang: Lang; isOwner: boolean }) {
  const [links, setLinks] = useState<Partial<Record<Scope, string>>>({});
  const [busy, setBusy] = useState<Scope | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const [copied, setCopied] = useState<Scope | null>(null);

  async function load(scope: Scope, reset: boolean) {
    if (reset && !window.confirm(t(lang, "callink_reset_confirm"))) return;
    setBusy(scope);
    setError(null);
    const r = await calendarFeedAction(scope, reset);
    setBusy(null);
    if (!r.ok) {
      setError("error_generic");
      return;
    }
    setLinks((l) => ({ ...l, [scope]: `${canonicalSiteUrl()}/api/calendar/${r.token}.ics` }));
  }

  async function copy(scope: Scope, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(scope);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // The link stays on screen to copy by hand.
    }
  }

  const scopes: Scope[] = isOwner ? ["me", "clinic"] : ["me"];
  return (
    <details className="card links-card" style={{ marginBottom: 12 }}>
      <summary>
        <span className="links-card-title">{t(lang, "callink_title")}</span>
        <span className="hint">{t(lang, "callink_sub")}</span>
      </summary>
      <ul className="links-list">
        {scopes.map((scope) => {
          const url = links[scope];
          const webcal = url ? url.replace(/^https?:/, "webcal:") : null;
          return (
            <li key={scope}>
              <div className="cv-top">
                <strong>{t(lang, scope === "me" ? "callink_me" : "callink_clinic")}</strong>
                {!url && (
                  <button type="button" className="btn ghost sm" disabled={busy === scope} onClick={() => void load(scope, false)}>
                    {busy === scope ? t(lang, "loading") : t(lang, "callink_show")}
                  </button>
                )}
              </div>
              {url && webcal && (
                <>
                  <p className="links-url" dir="ltr">
                    {url}
                  </p>
                  <div className="toolbar" style={{ marginTop: 6 }}>
                    <a
                      className="btn sm"
                      href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t(lang, "callink_google")}
                    </a>
                    <a className="btn ghost sm" href={webcal}>
                      {t(lang, "callink_apple")}
                    </a>
                    <button type="button" className="btn ghost sm" onClick={() => void copy(scope, url)}>
                      {copied === scope ? t(lang, "confirm") : t(lang, "copy_link")}
                    </button>
                    <button type="button" className="btn danger sm" disabled={busy === scope} onClick={() => void load(scope, true)}>
                      {t(lang, "callink_reset")}
                    </button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="error-text">{t(lang, error)}</p>}
      <p className="hint">{t(lang, "callink_hint")}</p>
    </details>
  );
}
