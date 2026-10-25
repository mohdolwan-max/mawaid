import Link from "next/link";
import { requireOrgContext } from "@/lib/org";
import { t } from "@/lib/i18n";
import { ImportClient } from "./ImportClient";

// Bringing a clinic's existing customers in (0073). The owner's: a list of
// people is the clinic's to decide on.
export default async function ImportCustomersPage() {
  const ctx = await requireOrgContext();
  const lang = ctx.lang;
  return (
    <div>
      <div className="page-head">
        <div>
          <Link href="/customers" className="hint">
            {t(lang, "cust_back")}
          </Link>
          <h2 style={{ marginTop: 4 }}>{t(lang, "import_title")}</h2>
          <p className="sub">{t(lang, "import_sub")}</p>
        </div>
      </div>
      {ctx.role === "owner" ? (
        <ImportClient lang={lang} />
      ) : (
        <div className="card">
          <p className="hint">{t(lang, "import_owner_only")}</p>
        </div>
      )}
    </div>
  );
}
