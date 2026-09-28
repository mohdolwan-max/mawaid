"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang } from "@/lib/i18n";
import { marketName, type Market } from "@/lib/markets";
import { setAdminCountry } from "./actions";

// Which country every admin page shows (0056). "All countries" adds up
// counts across countries but keeps money per currency: the pages never
// add dinars to riyals.
export function CountrySwitcher({
  lang,
  markets,
  current,
}: {
  lang: Lang;
  markets: Market[];
  /** null = all countries */
  current: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function pick(code: string | null) {
    if (code === current) return;
    startTransition(async () => {
      await setAdminCountry(code);
      router.refresh();
    });
  }

  return (
    <div className="admin-chips admin-country" role="group" aria-label={t(lang, "admin_country")} aria-busy={pending}>
      <button type="button" aria-pressed={current === null} disabled={pending} onClick={() => pick(null)}>
        {t(lang, "admin_all_countries")}
      </button>
      {markets.map((m) => (
        <button key={m.code} type="button" aria-pressed={current === m.code} disabled={pending} onClick={() => pick(m.code)}>
          {marketName(m, lang)} <span>{m.currency}</span>
        </button>
      ))}
    </div>
  );
}
