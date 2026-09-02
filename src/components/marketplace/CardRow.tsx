import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import type { DirectoryOrg } from "@/lib/directory";
import { OrgCard } from "./OrgCard";
import { ScrollRow } from "./ScrollRow";

export function CardRow({
  title,
  seeAllHref,
  orgs,
  lang,
}: {
  title: string;
  /** Omitted for rows whose ordering no destination page can reproduce —
   *  a "see all" that lands on a differently-sorted list silently changes
   *  the question it answers. */
  seeAllHref?: string;
  orgs: DirectoryOrg[];
  lang: Lang;
}) {
  if (orgs.length === 0) return null;

  return (
    <section className="card-band">
      <div className="hrow-head">
        <h2>{title}</h2>
        {seeAllHref && <Link href={seeAllHref}>{t(lang, "see_all")}</Link>}
      </div>
      <ScrollRow className="hrow">
        {orgs.map((org) => (
          <OrgCard key={org.org_id} org={org} lang={lang} />
        ))}
      </ScrollRow>
    </section>
  );
}
