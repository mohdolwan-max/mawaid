import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { CATEGORIES } from "@/lib/directory";

export function CategoryChips({ lang, active }: { lang: Lang; active?: string | null }) {
  return (
    <div className="cat-chip-row">
      {CATEGORIES.map((cat) => (
        <Link
          key={cat.key}
          href={`/search?category=${cat.key}`}
          className={`cat-chip ${active === cat.key ? "on" : ""}`}
        >
          <span>{cat.emoji}</span>
          {cat[lang]}
        </Link>
      ))}
    </div>
  );
}
