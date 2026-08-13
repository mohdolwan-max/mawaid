import { t, type Lang } from "@/lib/i18n";

// Plain GET form → /search?q=... — no client JS needed.
export function SearchBar({ lang }: { lang: Lang }) {
  return (
    <form action="/search" method="get">
      <input type="search" name="q" placeholder={t(lang, "market_search_placeholder")} />
      <button type="submit" className="btn">
        {t(lang, "nav_search")}
      </button>
    </form>
  );
}
