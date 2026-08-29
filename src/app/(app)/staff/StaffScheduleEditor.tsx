"use client";

import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import type { BusinessHours, StaffTimeOff } from "@/lib/types";
import { BusinessHoursGrid } from "@/components/BusinessHoursGrid";
import { saveStaffSchedule, addTimeOff, removeTimeOff } from "./actions";

// Inline expandable panel (no modal, matching this app's existing
// pattern) shown under a staff row: per-staff hours (or "inherits the
// org's hours") + a simple time-off list.
export function StaffScheduleEditor({
  lang,
  membershipId,
  orgHours,
  staffHours,
  timeOff,
}: {
  lang: Lang;
  membershipId: string;
  orgHours: BusinessHours;
  staffHours: BusinessHours | null;
  timeOff: StaffTimeOff[];
}) {
  const [customized, setCustomized] = useState(staffHours !== null);
  const [hours, setHours] = useState<BusinessHours>(staffHours ?? orgHours);
  const [saving, setSaving] = useState(false);

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [addingOff, setAddingOff] = useState(false);

  async function persist(nextCustomized: boolean, nextHours: BusinessHours) {
    setSaving(true);
    await saveStaffSchedule(membershipId, nextCustomized ? nextHours : null);
    setSaving(false);
  }

  return (
    <div className="card" style={{ background: "var(--bg)", marginTop: 4, marginBottom: 10 }}>
      <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "staff_schedule_title")}</p>

      {!customized ? (
        <div className="toolbar">
          <span className="chip neutral">{t(lang, "staff_uses_org_hours")}</span>
          <button
            type="button"
            className="btn ghost sm"
            disabled={saving}
            onClick={() => {
              setCustomized(true);
              setHours(orgHours);
              persist(true, orgHours);
            }}
          >
            {t(lang, "staff_use_custom_hours")}
          </button>
        </div>
      ) : (
        <>
          <BusinessHoursGrid
            lang={lang}
            hours={hours}
            onChange={(next) => {
              setHours(next);
              persist(true, next);
            }}
          />
          <button
            type="button"
            className="btn ghost sm"
            disabled={saving}
            onClick={() => {
              setCustomized(false);
              persist(false, hours);
            }}
          >
            {t(lang, "staff_revert_org_hours")}
          </button>
        </>
      )}

      <p style={{ fontWeight: 700, margin: "16px 0 10px" }}>{t(lang, "staff_time_off_title")}</p>
      {timeOff.length === 0 ? (
        <p className="hint">{t(lang, "time_off_empty")}</p>
      ) : (
        timeOff.map((off) => (
          <div key={off.id} className="service-row" style={{ cursor: "default", padding: "8px 12px" }}>
            <div>
              <span dir="ltr" style={{ fontSize: 12.5 }}>
                {new Date(off.starts_at).toLocaleString(lang === "ar" ? "ar-JO" : "en-US", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
                {" → "}
                {new Date(off.ends_at).toLocaleString(lang === "ar" ? "ar-JO" : "en-US", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
              {off.reason && <p className="hint">{off.reason}</p>}
            </div>
            <button type="button" className="btn danger sm" onClick={() => removeTimeOff(off.id)}>
              {t(lang, "delete")}
            </button>
          </div>
        ))
      )}

      <form
        className="toolbar"
        style={{ marginTop: 10 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!start || !end) return;
          setAddingOff(true);
          await addTimeOff({
            membershipId,
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(end).toISOString(),
            reason,
          });
          setStart("");
          setEnd("");
          setReason("");
          setAddingOff(false);
        }}
      >
        <div className="field" style={{ marginBottom: 0 }}>
          <label>{t(lang, "time_off_from")}</label>
          <input type="datetime-local" dir="ltr" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>{t(lang, "time_off_to")}</label>
          <input type="datetime-local" dir="ltr" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </div>
        <div className="field" style={{ marginBottom: 0, flex: 1 }}>
          <label>{t(lang, "time_off_reason")}</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button type="submit" className="btn sm" disabled={addingOff} style={{ marginTop: 18 }}>
          {t(lang, "time_off_add")}
        </button>
      </form>
    </div>
  );
}
