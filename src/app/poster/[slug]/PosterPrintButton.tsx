"use client";

import { t, type Lang } from "@/lib/i18n";

// The print dialog also saves as PDF, for a print shop.
export function PosterPrintButton({ lang }: { lang: Lang }) {
  return (
    <button type="button" className="btn sm" onClick={() => window.print()}>
      {t(lang, "qr_print")}
    </button>
  );
}
