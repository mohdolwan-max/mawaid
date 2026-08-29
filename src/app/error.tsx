"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";

// Catches any unexpected runtime error in a Server/Client Component
// render (must be a Client Component — Next.js requirement). A
// Server Component can't read the lang cookie here since this itself
// runs after a render already failed, so language comes from the
// <html lang> attribute the root layout already set instead — read
// after mount since `document` isn't available during the server pass.
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [lang, setLang] = useState<Lang>("ar");

  useEffect(() => {
    console.error(error);
    if (document.documentElement.lang === "en") setLang("en");
  }, [error]);

  return (
    <div className="market-shell">
      <div className="empty-state">
        <h1>{t(lang, "error_title")}</h1>
        <p>{t(lang, "error_sub")}</p>
        <div className="toolbar" style={{ justifyContent: "center" }}>
          <button type="button" className="btn" onClick={() => reset()}>
            {t(lang, "try_again")}
          </button>
          <Link href="/" className="btn ghost">
            {t(lang, "back_home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
