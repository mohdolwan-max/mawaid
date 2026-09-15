"use client";

import { t, type Lang } from "@/lib/i18n";

// The browser's print dialog also saves as PDF, which is what gets sent
// to an accountant; the print stylesheet hides everything but the report.
export function PrintButton({ lang }: { lang: Lang }) {
  return (
    <button type="button" className="btn sm" onClick={() => window.print()}>
      {t(lang, "report_print")}
    </button>
  );
}
