import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import { todayYMD, nowIso } from "@/lib/date";
import { CalendarIcon, ClockIcon } from "@/components/icons";
import { PublicLinkCard } from "./PublicLinkCard";

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

  return (
    <div>
      <div className="dash-hero">
        <div>
          <h2>{t(ctx.lang, "nav_dashboard")}</h2>
          <p>{t(ctx.lang, "dash_overview_sub")}</p>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="tile-icon" style={{ background: "var(--good-bg)", color: "var(--good-ink)" }}>
            <CalendarIcon size={19} />
          </div>
          <div className="t-label">{t(ctx.lang, "bookings_today")}</div>
          <div className="t-value">{todayCount ?? 0}</div>
        </div>
        <div className="tile">
          <div className="tile-icon" style={{ background: "var(--tint)", color: "var(--brand)" }}>
            <ClockIcon size={19} />
          </div>
          <div className="t-label">{t(ctx.lang, "bookings_upcoming")}</div>
          <div className="t-value">{upcomingCount ?? 0}</div>
        </div>
      </div>

      <PublicLinkCard lang={ctx.lang} slug={ctx.slug} />
    </div>
  );
}
