"use client";

import { useState } from "react";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { canonicalSiteUrl } from "@/lib/siteUrl";
import { LINK_SOURCES, clinicSourceUrl } from "@/lib/qr";

// One booking link per place the clinic can put one (0065, roadmap item
// 5). Google's booking button and Instagram's "Book now" button only take
// those companies' partners, but a Google Business Profile takes an
// appointment link from anyone and an Instagram profile a website link.
// Each link is marked, so the report says which place brought the
// booking. Folded by default: it is set up once, then rarely opened.
export function BookingLinksCard({ lang, slug }: { lang: Lang; slug: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const site = canonicalSiteUrl();

  async function copy(source: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(source);
      setTimeout(() => setCopied((c) => (c === source ? null : c)), 1500);
    } catch {
      // A browser that refuses the clipboard still shows the link to copy
      // by hand; nothing to report.
    }
  }

  return (
    <details className="card links-card">
      <summary>
        <span className="links-card-title">{t(lang, "links_title")}</span>
        <span className="hint">{t(lang, "links_sub")}</span>
      </summary>
      <ul className="links-list">
        {LINK_SOURCES.map((source) => {
          const url = clinicSourceUrl(site, slug, source);
          return (
            <li key={source}>
              <div className="cv-top">
                <strong>{t(lang, `source_${source}` as TKey)}</strong>
                <button type="button" className="btn ghost sm" onClick={() => void copy(source, url)}>
                  {copied === source ? t(lang, "confirm") : t(lang, "copy_link")}
                </button>
              </div>
              <p className="links-url" dir="ltr">
                {url}
              </p>
              <p className="hint">{t(lang, `links_how_${source}` as TKey)}</p>
            </li>
          );
        })}
      </ul>
      <p className="hint">{t(lang, "links_report_hint")}</p>
    </details>
  );
}
