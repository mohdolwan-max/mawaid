import Link from "next/link";
import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { t, type TKey } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";
import { ensureCustomerProfile } from "@/lib/customer";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { AccountClient } from "./AccountClient";
import { DeleteAccountCard } from "@/components/DeleteAccountCard";
import { getPendingDeletion } from "./deleteActions";

type NonCustomerKind = "admin" | "clinic" | "no_clinic";

const NON_CUSTOMER: Record<NonCustomerKind, { notice: TKey; cta: TKey; href: string }> = {
  admin: { notice: "cust_is_admin_notice", cta: "cust_go_admin", href: "/admin" },
  clinic: { notice: "cust_is_org_notice", cta: "cust_go_dashboard", href: "/dashboard" },
  no_clinic: { notice: "cust_no_clinic_notice", cta: "cust_go_onboarding", href: "/onboarding" },
};

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
  const pendingDeletion = user ? await getPendingDeletion() : null;

  // Owner report: signed in with the admin account, this page said "this
  // account is registered as a business" and offered a dashboard that
  // bounced to "create a clinic" — and never said which account it was.
  // Any signed-in non-customer is now told who they are signed in as and
  // sent where that account actually belongs.
  let kind: NonCustomerKind | null = null;
  if (user && !profile) {
    const [{ data: context }, { data: isAdmin }] = await Promise.all([
      supabase.rpc("get_my_context").maybeSingle(),
      supabase.rpc("is_platform_admin"),
    ]);
    kind = context ? "clinic" : isAdmin === true ? "admin" : "no_clinic";
  }

  return (
    <div className="market-shell">
      <PublicNav lang={lang} city={city} />
      <div className="center-shell" style={{ minHeight: "auto", paddingTop: 20 }}>
        <div className="auth-card card">
          {kind ? (
            <div style={{ textAlign: "center" }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>{t(lang, NON_CUSTOMER[kind].notice)}</p>
              {user?.email && (
                <p className="hint" style={{ marginBottom: 12 }}>
                  {t(lang, "cust_signed_in_as")} <span dir="ltr">{user.email}</span>
                </p>
              )}
              <Link href={NON_CUSTOMER[kind].href} className="btn block">
                {t(lang, NON_CUSTOMER[kind].cta)}
              </Link>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full navigation to a Route Handler (GET /auth/signout) */}
              <a href="/auth/signout" className="btn ghost block" style={{ marginTop: 8 }}>
                {t(lang, "signout")}
              </a>
            </div>
          ) : (
            <AccountClient lang={lang} profile={profile} next={next ?? null} />
          )}
        </div>
      </div>
      {/* Signed-in customers only: an org user manages deletion from
          /settings instead, and a signed-out visitor has nothing to delete. */}
      {profile && (
        <div style={{ maxWidth: 420, margin: "0 auto" }}>
          <DeleteAccountCard lang={lang} pendingUntil={pendingDeletion} />
        </div>
      )}
      <BottomNav lang={lang} />
    </div>
  );
}
