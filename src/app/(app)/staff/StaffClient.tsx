"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import type { BusinessHours, Service, StaffMember, StaffTimeOff } from "@/lib/types";
import { staffOwnerLabel } from "@/lib/staffLabel";
import {
  addStaffMember,
  cancelInvitation,
  removeStaffMember,
  renameStaffMember,
  inviteStaff,
  toggleStaffService,
} from "./actions";
import { StaffScheduleEditor } from "./StaffScheduleEditor";

// Inline rename. Until this existed nothing in the app could set
// display_name at all, so every staff member was nameless and the
// customer-facing picker had only their email to fall back on.
function NameCell({ lang, member }: { lang: Lang; member: StaffMember }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(member.display_name ?? "");
  const [title, setTitle] = useState(member.title ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  if (!editing) {
    return (
      <button
        type="button"
        className="btn ghost sm"
        style={{ fontWeight: 700 }}
        onClick={() => setEditing(true)}
      >
        {staffOwnerLabel(member, lang)}
      </button>
    );
  }

  return (
    <div className="toolbar" style={{ gap: 4 }}>
      <input
        value={title}
        placeholder={t(lang, "staff_title_placeholder")}
        onChange={(e) => setTitle(e.target.value)}
        style={{ minWidth: 90 }}
      />
      <input
        value={name}
        autoFocus
        placeholder={t(lang, "staff_name_label")}
        onChange={(e) => setName(e.target.value)}
        style={{ minWidth: 120 }}
      />
      <input
        value={phone}
        dir="ltr"
        inputMode="tel"
        placeholder={t(lang, "staff_phone_label")}
        onChange={(e) => setPhone(e.target.value)}
        style={{ minWidth: 110 }}
      />
      <button
        type="button"
        className="btn sm"
        disabled={saving || !name.trim()}
        onClick={async () => {
          setSaving(true);
          await renameStaffMember(member.membership_id ?? "", name, title, phone);
          setSaving(false);
          setEditing(false);
          router.refresh();
        }}
      >
        {t(lang, "save")}
      </button>
      <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>
        {t(lang, "cancel")}
      </button>
    </div>
  );
}

export function StaffClient({
  lang,
  staff,
  services,
  assignments,
  timeOff,
  orgHours,
  canManage,
  seatsUsed,
  seatsMax,
}: {
  lang: Lang;
  staff: StaffMember[];
  services: Service[];
  assignments: { staff_membership_id: string; service_id: string }[];
  timeOff: StaffTimeOff[];
  orgHours: BusinessHours;
  canManage: boolean;
  /** Seats the plan counts as used, and the ceiling. null when the plan
   *  could not be read — never 0, which would read as "none used". A
   *  pending invitation holds a seat, which is what made "4 of 5" look
   *  wrong next to one staff member (0055). */
  seatsUsed: number | null;
  seatsMax: number | null;
}) {
  const addRef = useRef<HTMLFormElement>(null);
  const inviteRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<TKey | null>(null);

  // A pending invitation has no membership yet, so it is assigned nothing.
  const isAssigned = (membershipId: string | null, serviceId: string) =>
    membershipId !== null &&
    assignments.some((a) => a.staff_membership_id === membershipId && a.service_id === serviceId);

  return (
    <div>
      {canManage && (
        <div className="card">
          <p style={{ fontWeight: 700, marginBottom: 4 }}>{t(lang, "staff_add_by_name")}</p>
          <p className="hint" style={{ marginBottom: 12 }}>{t(lang, "staff_add_hint")}</p>
          <form
            ref={addRef}
            action={async (formData) => {
              setError(null);
              const res = await addStaffMember(formData);
              if (res?.error) {
                setError(res.error);
                return;
              }
              addRef.current?.reset();
            }}
          >
            <div className="grid3">
              <div className="field">
                <label htmlFor="staff_title">{t(lang, "staff_title_label")}</label>
                <input
                  id="staff_title"
                  name="title"
                  placeholder={t(lang, "staff_title_placeholder")}
                />
              </div>
              <div className="field">
                <label htmlFor="staff_name">{t(lang, "staff_name_label")}</label>
                <input id="staff_name" name="name" required />
              </div>
              <div className="field">
                <label htmlFor="staff_phone">{t(lang, "staff_phone_label")}</label>
                <input id="staff_phone" name="phone" dir="ltr" inputMode="tel" />
              </div>
            </div>
            <button type="submit" className="btn">
              {t(lang, "staff_add_cta")}
            </button>
          </form>
        </div>
      )}

      {canManage && (
        <div className="card">
          <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "staff_invite_title")}</p>
          <form
            ref={inviteRef}
            action={async (formData) => {
              setError(null);
              const res = await inviteStaff(formData);
              if (res?.error) {
                setError(res.error);
                return;
              }
              inviteRef.current?.reset();
            }}
          >
            <div className="toolbar">
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="email">{t(lang, "staff_invite_email")}</label>
                <input id="email" name="email" type="email" required />
              </div>
              <button type="submit" className="btn ghost" style={{ marginTop: 18 }}>
                {t(lang, "staff_invite")}
              </button>
            </div>
          </form>
        </div>
      )}

      {error && <p className="error-text">{t(lang, error)}</p>}

      {/* The counter on the dashboard says "4 of 5" and the list shows one
          person: a pending invitation holds a seat until it is accepted or
          withdrawn (0043/0055). Saying so where the list is beats leaving
          the owner to work it out. */}
      {canManage && seatsUsed !== null && (
        <p className="hint" style={{ marginBottom: 8 }}>
          {seatsMax === null
            ? t(lang, "staff_seats_unlimited", { used: seatsUsed.toLocaleString(intlLocale(lang)) })
            : t(lang, "staff_seats", {
                used: seatsUsed.toLocaleString(intlLocale(lang)),
                max: seatsMax.toLocaleString(intlLocale(lang)),
              })}{" "}
          {t(lang, "staff_seats_hint")}
        </p>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t(lang, "staff_name_label")}</th>
              <th>{t(lang, "customer_phone")}</th>
              <th>{t(lang, "staff_role_staff")}</th>
              <th></th>
              {canManage && <th>{t(lang, "staff_services_label")}</th>}
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => (
              <Fragment key={member.membership_id ?? member.email}>
                <tr>
                <td>
                  {member.pending || !canManage ? (
                    staffOwnerLabel(member, lang)
                  ) : (
                    <NameCell lang={lang} member={member} />
                  )}
                </td>
                <td dir="ltr">{member.phone ?? "—"}</td>
                <td>{t(lang, member.role === "owner" ? "staff_role_owner" : "staff_role_staff")}</td>
                <td>
                  {member.pending && (
                    <div className="toolbar" style={{ gap: 6 }}>
                      <span className="chip warn">{t(lang, "staff_pending")}</span>
                      {canManage && member.invitation_id && (
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={pending}
                          onClick={() => {
                            if (!confirm(t(lang, "staff_confirm_cancel_invite", { email: member.email ?? "" }))) return;
                            setError(null);
                            startTransition(async () => {
                              const res = await cancelInvitation(member.invitation_id!);
                              if (!res.ok) setError("error_generic");
                              router.refresh();
                            });
                          }}
                        >
                          {t(lang, "staff_cancel_invite")}
                        </button>
                      )}
                    </div>
                  )}
                </td>
                {canManage && (
                  <td>
                    {!member.pending && member.role === "staff" && (
                      <div className="toolbar">
                        {services.map((s) => (
                          <label
                            key={s.id}
                            style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 0, fontWeight: 400 }}
                          >
                            <input
                              type="checkbox"
                              style={{ width: "auto" }}
                              checked={isAssigned(member.membership_id, s.id)}
                              onChange={() =>
                                toggleStaffService(
                                  member.membership_id ?? "",
                                  s.id,
                                  isAssigned(member.membership_id, s.id)
                                )
                              }
                            />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    )}
                  </td>
                )}
                {canManage && (
                  <td>
                    {!member.pending && (
                      <div className="toolbar">
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() =>
                            setExpanded(expanded === member.membership_id ? null : member.membership_id)
                          }
                        >
                          {t(lang, "staff_schedule_btn")}
                        </button>
                        {member.role === "staff" && (
                          <button
                            type="button"
                            className="btn danger sm"
                            onClick={() => {
                              if (!confirm(t(lang, "staff_remove_confirm"))) return;
                              setError(null);
                              startTransition(async () => {
                                const res = await removeStaffMember(member.membership_id ?? "");
                                if (res?.error) setError(res.error);
                                else router.refresh();
                              });
                            }}
                          >
                            {t(lang, "staff_remove")}
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                )}
                </tr>
                {/* Directly beneath the row it belongs to. It used to be
                    rendered in a block after the whole table (and after
                    the hint text below it), which put it ~376px under the
                    button that opens it — off-screen on a laptop, with no
                    scroll, so clicking "Schedule" looked like it did
                    nothing at all. */}
                {canManage && expanded === member.membership_id && (
                  <tr>
                    <td colSpan={canManage ? 6 : 4} style={{ padding: 0 }}>
                      <StaffScheduleEditor
                        lang={lang}
                        membershipId={member.membership_id ?? ""}
                        orgHours={orgHours}
                        staffHours={member.business_hours}
                        timeOff={timeOff.filter((o) => o.staff_membership_id === member.membership_id)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{t(lang, "staff_any_service")}</p>

      {canManage && staff.some((m) => !m.pending && !m.display_name) && (
        <p className="hint">{t(lang, "staff_needs_name_hint")}</p>
      )}
    </div>
  );
}
