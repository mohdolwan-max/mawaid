import { requireOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { t } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { getAvailableSlotsChain } from "@/lib/availability";
import { staffOwnerLabel } from "@/lib/staffLabel";
import type { StaffMember } from "@/lib/types";
import { groupByDay, parseWaitlist } from "@/lib/waitlist";
import { WaitlistClient, type WaitlistRow } from "./WaitlistClient";

// Everyone waiting for a day with no free time (0066), soonest day first.
// Beside each, whether a time is free for them right now: the same
// availability the booking page offers, so "free" means bookable.
const CHECK_LIMIT = 40;

export default async function WaitlistPage() {
  const ctx = await requireOrgContext();
  const lang = ctx.lang;
  const supabase = await createClient();
  const [{ data, error }, { data: staffRows }] = await Promise.all([
    supabase.rpc("list_waitlist"),
    supabase.rpc("list_org_staff", { p_org_id: ctx.orgId }),
  ]);

  const head = (
    <div className="page-head">
      <div>
        <h2>{t(lang, "wl_title")}</h2>
        <p className="sub">{t(lang, "wl_sub")}</p>
      </div>
    </div>
  );

  // A failed read is an error, never an empty list (§1). PGRST202 is the
  // migration not run yet: same message, not logged.
  if (error) {
    if (error.code !== "PGRST202") console.error("list_waitlist failed", error);
    return (
      <div>
        {head}
        <div className="card">
          <p className="error-text">{t(lang, "error_generic")}</p>
        </div>
      </div>
    );
  }

  const entries = parseWaitlist(data);
  const staffLabel = new Map<string, string>();
  ((staffRows as StaffMember[]) ?? []).forEach((m) => {
    if (m.membership_id) staffLabel.set(m.membership_id, staffOwnerLabel(m, lang));
  });

  // One availability lookup per distinct request, for the nearest entries.
  // null = not checked (beyond the limit, or the lookup failed), never
  // "no time".
  const free = new Map<string, string[] | null>();
  const key = (ids: string[], day: string, staff: string | null) => `${ids.join(",")}|${day}|${staff ?? ""}`;
  const toCheck = [...new Set(entries.slice(0, CHECK_LIMIT).map((e) => key(e.serviceIds, e.day, e.staffId)))];
  await Promise.all(
    toCheck.map(async (k) => {
      const [ids, day, staff] = k.split("|");
      try {
        free.set(k, await getAvailableSlotsChain(ctx.slug, ids.split(","), day, staff || null));
      } catch {
        free.set(k, null);
      }
    })
  );

  const locale = intlLocale(lang);
  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  const clock = (iso: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: ctx.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

  const groups = groupByDay(entries).map((g) => ({
    day: g.day,
    label: dayLabel(g.day),
    rows: g.entries.map((e): WaitlistRow => {
      const slots = free.has(key(e.serviceIds, e.day, e.staffId)) ? free.get(key(e.serviceIds, e.day, e.staffId))! : null;
      return {
        id: e.id,
        name: e.name,
        phone: e.phone,
        email: e.email,
        services: e.serviceNames.join("، "),
        staff: e.staffId ? (staffLabel.get(e.staffId) ?? t(lang, "reports_staff_gone")) : null,
        freed: e.freedAt !== null,
        emailed: e.notifiedAt !== null,
        freeCount: slots === null ? null : slots.length,
        firstFree: slots && slots.length > 0 ? clock(slots[0]) : null,
      };
    }),
  }));

  return (
    <div>
      {head}
      {entries.length === 0 ? (
        <div className="card">
          <div className="empty">{t(lang, "wl_empty")}</div>
        </div>
      ) : (
        <WaitlistClient lang={lang} orgName={ctx.name} groups={groups} />
      )}
    </div>
  );
}
