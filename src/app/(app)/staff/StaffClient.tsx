"use client";

import { useRef } from "react";
import { t, type Lang } from "@/lib/i18n";
import type { Service, StaffMember } from "@/lib/types";
import { inviteStaff, toggleStaffService } from "./actions";

export function StaffClient({
  lang,
  staff,
  services,
  assignments,
  canManage,
}: {
  lang: Lang;
  staff: StaffMember[];
  services: Service[];
  assignments: { staff_membership_id: string; service_id: string }[];
  canManage: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);

  const isAssigned = (membershipId: string, serviceId: string) =>
    assignments.some((a) => a.staff_membership_id === membershipId && a.service_id === serviceId);

  return (
    <div>
      {canManage && (
        <div className="card">
          <form
            ref={formRef}
            action={async (formData) => {
              await inviteStaff(formData);
              formRef.current?.reset();
            }}
          >
            <div className="toolbar">
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="email">{t(lang, "staff_invite_email")}</label>
                <input id="email" name="email" type="email" required />
              </div>
              <button type="submit" className="btn" style={{ marginTop: 18 }}>
                {t(lang, "staff_invite")}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t(lang, "email")}</th>
              <th>{t(lang, "staff_role_staff")}</th>
              <th></th>
              {canManage && <th>{t(lang, "staff_services_label")}</th>}
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => (
              <tr key={member.membership_id ?? member.email}>
                <td>{member.email}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{t(lang, "staff_any_service")}</p>
    </div>
  );
}
