import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { getMyPlanUsage } from "@/lib/planServer";
import { Sidebar } from "./Sidebar";
import { PlanNotice } from "./PlanNotice";
import { parseMyOrgs } from "@/lib/branches";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  // Counted here rather than on the dashboard so the badge follows the
  // owner around the app — a new booking is worth seeing while they are
  // on /services or /calendar, not only if they happen to go home.
  // Served by notifications_org_unread_idx, a partial index on exactly
  // this predicate.
  const [{ count, error }, planUsage, orgsRes] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ctx.orgId)
      .is("read_at", null),
    getMyPlanUsage(),
    // The user's clinics (0071), for the switcher. Missing before 0071
    // (PGRST202) or failed: no switcher, the app works as before.
    supabase.rpc("my_orgs"),
  ]);
  if (orgsRes.error && orgsRes.error.code !== "PGRST202") console.error("my_orgs failed", orgsRes.error);
  const orgs = orgsRes.error ? [] : parseMyOrgs(orgsRes.data);

  if (error) {
    // A failed count must not silently read as "nothing new".
    console.error("unread notification count failed", error);
  }

  return (
    <div className="app">
      <Sidebar lang={ctx.lang} orgName={ctx.name} unread={error ? null : (count ?? 0)} orgs={orgs} activeOrgId={ctx.orgId} />
      <main className="main">
        {planUsage && <PlanNotice usage={planUsage} lang={ctx.lang} isOwner={ctx.role === "owner"} />}
        {children}
      </main>
    </div>
  );
}
