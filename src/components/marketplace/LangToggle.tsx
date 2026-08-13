"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { t, type Lang } from "@/lib/i18n";
import { togglePublicLang } from "./actions";

export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  return (
    <button
      className="mh-link"
      onClick={() =>
        startTransition(async () => {
          await togglePublicLang(lang);
          router.refresh();
        })
      }
    >
      {t(lang, "lang_toggle")}
    </button>
  );
}
