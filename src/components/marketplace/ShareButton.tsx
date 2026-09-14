"use client";

import { useEffect, useRef, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { buildShareTargets } from "@/lib/share";
import { ShareIcon } from "@/components/icons";

// Share a clinic (owner request: "قدرة المستخدم على مشاركتها من خلال
// واتساب أو غيره"). Two paths, because the platforms differ:
//
//  * Phones expose navigator.share — the NATIVE share sheet, which reaches
//    every app the person actually has (WhatsApp, Instagram, SMS…). No
//    fixed list of buttons can match that, so it goes first.
//  * Desktop browsers mostly don't, so the same button opens an explicit
//    menu: WhatsApp (the channel that matters most here), Telegram,
//    Facebook, copy link.
export function ShareButton({
  lang,
  url,
  title,
  text,
  variant = "icon",
  showCopy = true,
}: {
  lang: Lang;
  url: string;
  title: string;
  text: string;
  /** "icon" = round button for page headers; "button" = labelled, for cards. */
  variant?: "icon" | "button";
  /** Off where a copy button already sits beside this one. */
  showCopy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const targets = buildShareTargets(url, text);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function share() {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        // Dismissing the sheet rejects with AbortError — that is the person
        // saying no, not a failure. Anything else (a payload the platform
        // refuses) falls through to the menu rather than a dead button.
        if ((e as DOMException)?.name === "AbortError") return;
      }
    }
    setOpen((v) => !v);
  }

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // The async clipboard needs a secure, focused context; the textarea
      // route still works where it doesn't. position:fixed so it can never
      // widen an RTL page (the scroll-area bug the booking honeypot hit).
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.left = "0";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    // Only claim "copied" when it was — a confirmation over a failed copy
    // sends someone off to paste nothing.
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <div className="share-wrap" ref={wrapRef}>
      {variant === "icon" ? (
        <button
          type="button"
          className="share-icon-btn"
          aria-label={t(lang, "share")}
          aria-expanded={open}
          onClick={share}
        >
          <ShareIcon size={18} />
        </button>
      ) : (
        <button type="button" className="btn ghost sm" aria-expanded={open} onClick={share}>
          <ShareIcon size={15} /> {t(lang, "share")}
        </button>
      )}

      {open && (
        <div className="share-menu" role="menu">
          <a role="menuitem" href={targets.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            <span className="share-dot" style={{ background: "#25D366" }} /> {t(lang, "share_whatsapp")}
          </a>
          <a role="menuitem" href={targets.telegram} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            <span className="share-dot" style={{ background: "#229ED9" }} /> {t(lang, "share_telegram")}
          </a>
          <a role="menuitem" href={targets.facebook} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
            <span className="share-dot" style={{ background: "#1877F2" }} /> {t(lang, "share_facebook")}
          </a>
          {showCopy && (
            <button role="menuitem" type="button" onClick={copy}>
              <span className="share-dot" style={{ background: "var(--brand)" }} />
              {copied ? t(lang, "share_copied") : t(lang, "copy_link")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
