"use client";

import Link from "next/link";
import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";

export function PublicLinkCard({ lang, slug }: { lang: Lang; slug: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/${slug}`;
  const fullUrl = typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  return (
    <div className="card link-card">
      <div className="link-card-icon">🔗</div>
      <div className="link-card-body">
        <label>{t(lang, "public_link_label")}</label>
        <Link href={path} target="_blank" className="link-card-url">
          {fullUrl}
        </Link>
      </div>
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
    </div>
  );
}
