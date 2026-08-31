import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import { todayYMD, addDaysYMD, weekYMDs } from "@/lib/date";
import type { Appointment, StaffMember } from "@/lib/types";
import { staffOwnerLabel } from "@/lib/staffLabel";
import { CalendarClient, type CalendarBooking } from "./CalendarClient";

// Loads a window wide enough for either view without a second round trip
// when the owner flips between them: the whole week the chosen day falls
// in, plus a day either side so a late-night appointment that belongs to
// the clinic's local Sunday is still in range when the server is on UTC.
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; v?: string }>;
}) {
  const ctx = await requireOrgContext();
  const supabase = await createClient();
  const sp = await searchParams;

  const today = todayYMD(ctx.timezone);
  const valid = typeof sp.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.d);
  const day = valid ? sp.d! : today;
  const view = sp.v === "week" ? "week" : "day";

  const week = weekYMDs(day, ctx.timezone);
  const from = addDaysYMD(week[0], -1);
  const to = addDaysYMD(week[6], 2);

  const [{ data: rows, error }, { data: staff }] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        "id, service_id, staff_id, customer_name, customer_phone, start_at, end_at, status, notes, services(name, price)"
      )
      .eq("org_id", ctx.orgId)
      .gte("start_at", `${from}T00:00:00Z`)
      .lt("start_at", `${to}T00:00:00Z`)
      .order("start_at"),
    supabase.rpc("list_org_staff", { p_org_id: ctx.orgId }),
  ]);

  // A failed query must not render as an empty calendar — an owner would
  // read that as "no bookings today" and stop checking
  // (ENGINEERING-STANDARDS §1). Surface it instead.
  if (error) {
    console.error("calendar: appointment query failed", error);
    return (
      <div>
        <div className="page-head">
          <h2>{t(ctx.lang, "nav_calendar")}</h2>
        </div>
        <div className="card">
          <p className="error-text">{t(ctx.lang, "error_generic")}</p>
        </div>
      </div>
    );
  }

  const staffList = ((staff as StaffMember[]) ?? []).filter((m) => !m.pending);
  const labelByMembership = new Map<string, string>();
  staffList.forEach((m) => {
    if (m.membership_id) labelByMembership.set(m.membership_id, staffOwnerLabel(m, ctx.lang));
  });

  type Row = {
    id: string;
    service_id: string;
    staff_id: string | null;
    customer_name: string;
    customer_phone: string;
    start_at: string;
    end_at: string;
    status: Appointment["status"];
    notes: string | null;
    services: { name: string; price: number | null } | { name: string; price: number | null }[] | null;
  };

  const bookings: CalendarBooking[] = ((rows as Row[]) ?? []).map((r) => {
    const svc = Array.isArray(r.services) ? r.services[0] : r.services;
    return {
      id: r.id,
      serviceId: r.service_id,
      serviceName: svc?.name ?? "",
      // Stays null when the service has no price. Not 0 — "not priced"
      // and "free" are different facts, and the day's total must not
      // quietly treat one as the other.
      price: svc?.price ?? null,
      staffId: r.staff_id,
      staffName: r.staff_id ? (labelByMembership.get(r.staff_id) ?? null) : null,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      startAt: r.start_at,
      endAt: r.end_at,
      status: r.status,
      notes: r.notes,
    };
  });

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{t(ctx.lang, "nav_calendar")}</h2>
          <p className="sub">{t(ctx.lang, "cal_sub")}</p>
        </div>
      </div>
      <CalendarClient
        lang={ctx.lang}
        timezone={ctx.timezone}
        today={today}
        day={day}
        view={view}
        businessHours={ctx.businessHours}
        bookings={bookings}
        staff={staffList.map((m) => ({
          id: m.membership_id ?? "",
          name: staffOwnerLabel(m, ctx.lang),
        }))}
      />
    </div>
  );
}
