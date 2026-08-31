"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import type { BusinessHours, Service, StaffMember, StaffTimeOff } from "@/lib/types";
import { staffOwnerLabel } from "@/lib/staffLabel";
import { addStaffMember, removeStaffMember, renameStaffMember, inviteStaff, toggleStaffService } from "./actions";
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
          await renameStaffMember(member.membership_id, name, title, phone);
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
}: {
  lang: Lang;
  staff: StaffMember[];
  services: Service[];
  assignments: { staff_membership_id: string; service_id: string }[];
  timeOff: StaffTimeOff[];
  orgHours: BusinessHours;
  canManage: boolean;
}) {
  const addRef = useRef<HTMLFormElement>(null);
  const inviteRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<TKey | null>(null);

  const isAssigned = (membershipId: string, serviceId: string) =>
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
              await inviteStaff(formData);
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
              <tr key={member.membership_id ?? member.email}>
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
                  {member.pending && <span className="chip warn">{t(lang, "staff_pending")}</span>}
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
                                  member.membership_id,
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
                                const res = await removeStaffMember(member.membership_id);
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
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{t(lang, "staff_any_service")}</p>

      {canManage && staff.some((m) => !m.pending && !m.display_name) && (
        <p className="hint">{t(lang, "staff_needs_name_hint")}</p>
      )}

      {canManage &&
        staff
          .filter((m) => m.membership_id === expanded)
          .map((m) => (
            <StaffScheduleEditor
              key={m.membership_id}
              lang={lang}
              membershipId={m.membership_id}
              orgHours={orgHours}
              staffHours={m.business_hours}
              timeOff={timeOff.filter((o) => o.staff_membership_id === m.membership_id)}
            />
          ))}
    </div>
  );
}
