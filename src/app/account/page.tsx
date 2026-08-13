import Link from "next/link";
import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { t } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { ensureCustomerProfile } from "@/lib/customer";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { AccountClient } from "./AccountClient";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ next }, lang, city] = await Promise.all([searchParams, getLang(), getCity()]);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ensureCustomerProfile also covers "confirmed email, first visit":
  // materializes the customers row from signup metadata.
  const profile = user ? await ensureCustomerProfile() : null;
  const isOrgUser = Boolean(user) && !profile;

  return (
    <div className="market-shell">
      <PublicNav lang={lang} city={city} />
      <div className="center-shell" style={{ minHeight: "auto", paddingTop: 20 }}>
        <div className="auth-card card">
          {isOrgUser ? (
            <div style={{ textAlign: "center" }}>
              <p style={{ fontWeight: 700, marginBottom: 12 }}>{t(lang, "cust_is_org_notice")}</p>
              <Link href="/dashboard" className="btn block">
                {t(lang, "cust_go_dashboard")}
              </Link>
            </div>
          ) : (
            <AccountClient lang={lang} profile={profile} next={next ?? null} />
          )}
        </div>
      </div>
      <BottomNav lang={lang} />
    </div>
  );
}
