"use client";

import { useEffect } from "react";
import { encodeStoredSource, sourceFromSearch, sourceStorageKey } from "@/lib/qr";

// Remembers, for this tab, that the clinic's page was opened from its QR
// code (?src=qr), so a booking made a few pages later can be counted as
// the poster's (0060). Renders nothing. Storage failure (private mode, a
// locked-down browser) only costs the count, never the visit.
export function SourceCapture({ slug }: { slug: string }) {
  useEffect(() => {
    const source = sourceFromSearch(window.location.search);
    if (!source) return;
    try {
      sessionStorage.setItem(sourceStorageKey(slug), encodeStoredSource(source, Date.now()));
    } catch {}
  }, [slug]);
  return null;
}
