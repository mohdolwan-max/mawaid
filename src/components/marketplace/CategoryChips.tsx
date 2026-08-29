import Image from "next/image";
import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { CATEGORIES } from "@/lib/directory";
import { BuildingIcon } from "@/components/icons";
import { ScrollRow } from "./ScrollRow";

// Wddk-style category picker: a colored icon "image" tile with the label
// underneath, not an inline pill. Categories with a real photo (see
// public/icons/) show that instead — "general" has none, so it falls
// back to a plain line icon rather than an emoji.
export function CategoryChips({ lang, active }: { lang: Lang; active?: string | null }) {
  return (
    <ScrollRow className="cat-chip-row">
      {CATEGORIES.map((cat) => (
        <Link
          key={cat.key}
          href={`/search?category=${cat.key}`}
          className={`cat-card ${active === cat.key ? "on" : ""}`}
        >
          <span
            className="cat-icon"
            style={{ background: cat.icon ? undefined : cat.color, color: "var(--brand)" }}
          >
            {cat.icon ? (
              <Image src={cat.icon} alt="" width={60} height={60} className="cat-icon-img" />
            ) : (
              <BuildingIcon size={26} />
            )}
          </span>
          <span className="cat-label">{cat[lang]}</span>
        </Link>
      ))}
    </ScrollRow>
  );
}
