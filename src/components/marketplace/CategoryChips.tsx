import Image from "next/image";
import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { CATEGORIES } from "@/lib/directory";

// Wddk-style category picker: a colored icon "image" tile with the label
// underneath, not an inline pill. Categories with a real photo (see
// public/icons/) show that instead of the emoji — "general" has none, so
// it keeps the emoji fallback.
export function CategoryChips({ lang, active }: { lang: Lang; active?: string | null }) {
  return (
    <div className="cat-chip-row">
      {CATEGORIES.map((cat) => (
        <Link
          key={cat.key}
          href={`/search?category=${cat.key}`}
          className={`cat-card ${active === cat.key ? "on" : ""}`}
        >
          <span className="cat-icon" style={{ background: cat.icon ? undefined : cat.color }}>
            {cat.icon ? (
              <Image src={cat.icon} alt="" width={60} height={60} className="cat-icon-img" />
            ) : (
              cat.emoji
            )}
          </span>
          <span className="cat-label">{cat[lang]}</span>
        </Link>
      ))}
    </div>
  );
}
