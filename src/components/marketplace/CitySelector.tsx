"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Lang } from "@/lib/i18n";
import { CITIES } from "@/lib/directory";
import { setCityAction } from "./actions";

export function CitySelector({ lang, city }: { lang: Lang; city: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <select
      value={city}
      aria-label={lang === "ar" ? "المدينة" : "City"}
      onChange={(e) => {
        const next = e.target.value;
        startTransition(async () => {
          await setCityAction(next);
          router.refresh();
        });
      }}
    >
      {CITIES.map((c) => (
        <option key={c.key} value={c.key}>
          {c[lang]}
        </option>
      ))}
    </select>
  );
}
