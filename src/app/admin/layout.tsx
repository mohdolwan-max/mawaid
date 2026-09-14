import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { isPlatformAdmin } from "@/lib/adminServer";
import { AdminNav } from "./AdminNav";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// The platform owner's pages (0049). Outside the clinic app shell on
// purpose: an admin does not need to own a clinic, and a clinic owner who
// is not an admin must not learn this page exists, so a non-admin gets
// the ordinary not-found page, not a "forbidden" one.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin");
  if (!(await isPlatformAdmin())) notFound();

  const lang = await getLang();

  return (
    <div className="admin-shell">
      <header className="admin-head">
        <div>
          <h1>{t(lang, "admin_title")}</h1>
          <p className="hint">{t(lang, "admin_sub")}</p>
        </div>
        <AdminNav lang={lang} />
      </header>
      {children}
    </div>
  );
}
