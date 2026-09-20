"use client";

import Link from "next/link";
import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { LinkIcon } from "@/components/icons";
import { canonicalSiteUrl } from "@/lib/siteUrl";
import { clinicShareUrl } from "@/lib/share";
import { ShareButton } from "@/components/marketplace/ShareButton";

export function PublicLinkCard({
  lang,
  slug,
  orgName,
}: {
  lang: Lang;
  slug: string;
  orgName: string;
}) {
  const [copied, setCopied] = useState(false);
  const path = `/${slug}`;
  // The canonical link, identical on server and client. This used to be
  // window.location.origin behind a typeof-window check — the server
  // rendered "/slug", the browser "https://…/slug", and that text
  // mismatch is the exact hydration failure that once left the bookings
  // page's buttons dead. It also meant a link copied from a preview
  // deployment pointed at the preview, not the real site.
  const fullUrl = clinicShareUrl(canonicalSiteUrl(), slug);

  return (
    <div className="card link-card">
      <div className="link-card-icon">
        <LinkIcon size={18} />
      </div>
      <div className="link-card-body">
        <label>{t(lang, "public_link_label")}</label>
        <Link href={path} target="_blank" className="link-card-url">
          {fullUrl}
        </Link>
      </div>
      <div className="toolbar" style={{ flexShrink: 0 }}>
        <button
          type="button"
          className="btn ghost sm"
          onClick={() => {
            navigator.clipboard.writeText(fullUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? t(lang, "confirm") : t(lang, "copy_link")}
        </button>
        {/* The owner is the person who most needs to spread this link. Copy
            already sits beside it, so the share menu leaves copy out. */}
        <ShareButton
          lang={lang}
          url={fullUrl}
          title={orgName}
          text={t(lang, "share_text", { name: orgName })}
          variant="button"
          showCopy={false}
        />
      </div>
    </div>
  );
}
