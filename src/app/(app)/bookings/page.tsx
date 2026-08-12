import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import { hoursAgoIso } from "@/lib/date";
import type { Appointment, Service, StaffMember } from "@/lib/types";
import { BookingsClient } from "./BookingsClient";

export default async function BookingsPage() {
  const ctx = await requireOrgContext();
  const supabase = await createClient();

  const [{ data: rows }, { data: services }, { data: staff }] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, org_id, service_id, staff_id, customer_name, customer_phone, customer_email, start_at, end_at, status, notes, services(name)")
      .eq("org_id", ctx.orgId)
      .gte("start_at", hoursAgoIso(24))
      .order("start_at"),
    supabase.from("services").select("*").eq("org_id", ctx.orgId).eq("active", true).order("sort_order"),
    supabase.rpc("list_org_staff", { p_org_id: ctx.orgId }),
  ]);

  const staffEmailByMembership = new Map<string, string>();
  ((staff as StaffMember[]) ?? []).forEach((m) => {
    if (m.membership_id) staffEmailByMembership.set(m.membership_id, m.email);
  });

  type Row = {
    id: string;
    org_id: string;
    service_id: string;
    staff_id: string | null;
    customer_name: string;
    customer_phone: string;
    customer_email: string | null;
    start_at: string;
    end_at: string;
    status: Appointment["status"];
    notes: string | null;
    services: { name: string } | { name: string }[] | null;
  };

  const appointments: Appointment[] = ((rows as Row[]) ?? []).map((r) => ({
    id: r.id,
    org_id: r.org_id,
    service_id: r.service_id,
    service_name: Array.isArray(r.services) ? (r.services[0]?.name ?? "") : (r.services?.name ?? ""),
    staff_id: r.staff_id,
    staff_email: r.staff_id ? (staffEmailByMembership.get(r.staff_id) ?? null) : null,
    customer_name: r.customer_name,
    customer_phone: r.customer_phone,
    customer_email: r.customer_email,
    start_at: r.start_at,
    end_at: r.end_at,
    status: r.status,
    notes: r.notes,
  }));

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>{t(ctx.lang, "bookings_title")}</h2>
        </div>
      </div>
      <BookingsClient
        lang={ctx.lang}
        appointments={appointments}
        services={(services as Service[]) ?? []}
        staff={((staff as StaffMember[]) ?? []).filter((m) => !m.pending)}
        timezone={ctx.timezone}
      />
    </div>
  );
}
