import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { CATEGORIES } from "@/lib/directory";

// Wddk-style category picker: a colored icon "image" tile with the label
// underneath, not an inline pill — easy to swap the emoji for a real
// photo/illustration per category later (just replace the span with an
// <img>, the surrounding .cat-icon box already sizes/crops for that).
export function CategoryChips({ lang, active }: { lang: Lang; active?: string | null }) {
  return (
    <div className="cat-chip-row">
      {CATEGORIES.map((cat) => (
        <Link
          key={cat.key}
          href={`/search?category=${cat.key}`}
          className={`cat-card ${active === cat.key ? "on" : ""}`}
        >
          <span className="cat-icon" style={{ background: cat.color }}>
            {cat.emoji}
          </span>
          <span className="cat-label">{cat[lang]}</span>
        </Link>
      ))}
    </div>
  );
}
