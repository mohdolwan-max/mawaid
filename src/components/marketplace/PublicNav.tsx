import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { CitySelector } from "./CitySelector";
import { LangToggle } from "./LangToggle";

export function PublicNav({ lang, city }: { lang: Lang; city: string }) {
  return (
    <header className="market-header">
      <Link href="/" className="mh-brand">
        {t(lang, "brand")}
      </Link>
      <div className="mh-side">
        <CitySelector lang={lang} city={city} />
        <LangToggle lang={lang} />
      </div>
    </header>
  );
}
