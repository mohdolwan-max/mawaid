import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import type { DirectoryOrg } from "@/lib/directory";
import { OrgCard } from "./OrgCard";

export function CardRow({
  title,
  seeAllHref,
  orgs,
  lang,
}: {
  title: string;
  seeAllHref: string;
  orgs: DirectoryOrg[];
  lang: Lang;
}) {
  if (orgs.length === 0) return null;

  return (
    <section>
      <div className="hrow-head">
        <h2>{title}</h2>
        <Link href={seeAllHref}>{t(lang, "see_all")}</Link>
      </div>
      <div className="hrow">
        {orgs.map((org) => (
          <OrgCard key={org.org_id} org={org} lang={lang} />
        ))}
      </div>
    </section>
  );
}
