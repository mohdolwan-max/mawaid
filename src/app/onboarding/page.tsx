import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLang } from "@/lib/lang";
import { t } from "@/lib/i18n";
import { getCustomerProfile } from "@/lib/customer";
import type { BusinessHours } from "@/lib/types";
import { OnboardingWizard } from "./OnboardingWizard";

export default async function OnboardingPage() {
  const lang = await getLang();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // A signed-in CUSTOMER who lands on an org route gets bounced through
  // requireOrgContext() → here; show a notice instead of the org wizard
  // so they never accidentally create a business org.
  const customer = await getCustomerProfile();
  if (customer) {
    return (
      <div className="center-shell">
        <div className="auth-card card" style={{ textAlign: "center" }}>
          <p style={{ fontWeight: 700, marginBottom: 14 }}>{t(lang, "org_area_notice")}</p>
          <div className="toolbar" style={{ justifyContent: "center" }}>
            <Link href="/" className="btn">
              {t(lang, "org_area_browse")}
            </Link>
            <Link href="/partners" className="btn ghost">
              {t(lang, "org_area_partners")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { data } = await supabase.rpc("get_my_context").maybeSingle();
  const ctx = data as { org_id: string; wizard_done: boolean; business_hours: BusinessHours } | null;

  if (ctx?.wizard_done) {
    redirect("/dashboard");
  }

  return (
    <div className="center-shell" style={{ alignItems: "flex-start", paddingTop: 48 }}>
      <OnboardingWizard
        lang={lang}
        existingOrgId={ctx?.org_id ?? null}
        existingBusinessHours={ctx?.business_hours ?? null}
      />
    </div>
  );
}
