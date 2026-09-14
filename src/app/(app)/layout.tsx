import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { getMyPlanUsage } from "@/lib/planServer";
import { Sidebar } from "./Sidebar";
import { PlanNotice } from "./PlanNotice";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  // Counted here rather than on the dashboard so the badge follows the
  // owner around the app — a new booking is worth seeing while they are
  // on /services or /calendar, not only if they happen to go home.
  // Served by notifications_org_unread_idx, a partial index on exactly
  // this predicate.
  const [{ count, error }, planUsage] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ctx.orgId)
      .is("read_at", null),
    getMyPlanUsage(),
  ]);

  if (error) {
    // A failed count must not silently read as "nothing new".
    console.error("unread notification count failed", error);
  }

  return (
    <div className="app">
      <Sidebar lang={ctx.lang} orgName={ctx.name} unread={error ? null : (count ?? 0)} />
      <main className="main">
        {planUsage && <PlanNotice usage={planUsage} lang={ctx.lang} isOwner={ctx.role === "owner"} />}
        {children}
      </main>
    </div>
  );
}
