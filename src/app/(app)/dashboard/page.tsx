import Link from "next/link";
import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import { todayYMD, nowIso } from "@/lib/date";

export default async function DashboardPage() {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  const today = todayYMD(ctx.timezone);
  const startOfDay = new Date(`${today}T00:00:00Z`).toISOString();
  const endOfDay = new Date(`${today}T23:59:59Z`).toISOString();

  const { count: todayCount } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId)
    .eq("status", "booked")
    .gte("start_at", startOfDay)
    .lte("start_at", endOfDay);

  const { count: upcomingCount } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId)
    .eq("status", "booked")
    .gte("start_at", nowIso());

  const publicUrl = `/${ctx.slug}`;

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{t(ctx.lang, "nav_dashboard")}</h2>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="t-label">{t(ctx.lang, "bookings_today")}</div>
          <div className="t-value">{todayCount ?? 0}</div>
        </div>
        <div className="tile">
          <div className="t-label">{t(ctx.lang, "bookings_upcoming")}</div>
          <div className="t-value">{upcomingCount ?? 0}</div>
        </div>
      </div>

      <div className="card">
        <label>{t(ctx.lang, "public_link_label")}</label>
        <p>
          <Link href={publicUrl} target="_blank">
            {publicUrl}
          </Link>
        </p>
      </div>
    </div>
  );
}
