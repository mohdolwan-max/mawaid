import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLang } from "@/lib/lang";
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
