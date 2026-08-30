"use client";

import { useState } from "react";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { todayYMD } from "@/lib/date";
import type { Appointment, Service, StaffMember } from "@/lib/types";
import { staffOwnerLabel } from "@/lib/staffLabel";
import { setBookingStatus, addManualBooking } from "./actions";

export function BookingsClient({
  lang,
  appointments,
  services,
  staff,
  timezone,
}: {
  lang: Lang;
  appointments: Appointment[];
  services: Service[];
  staff: StaffMember[];
  timezone: string;
}) {
  const [showForm, setShowForm] = useState(false);

  const today = todayYMD(timezone);
  const todays = appointments.filter((a) => a.start_at.startsWith(today) && a.status === "booked");
  const upcoming = appointments.filter((a) => !a.start_at.startsWith(today) && a.status === "booked");

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => setShowForm((v) => !v)}>
          {t(lang, "booking_add_manual")}
        </button>
      </div>

      {showForm && (
        <ManualBookingForm
          lang={lang}
          services={services}
          staff={staff}
          onDone={() => setShowForm(false)}
        />
      )}

      <BookingSection title={t(lang, "bookings_today")} lang={lang} rows={todays} />
      <BookingSection title={t(lang, "bookings_upcoming")} lang={lang} rows={upcoming} />
    </div>
  );
}

function BookingSection({ title, lang, rows }: { title: string; lang: Lang; rows: Appointment[] }) {
  return (
    <div className="card">
      <p style={{ fontWeight: 700, marginBottom: 10 }}>{title}</p>
      {rows.length === 0 ? (
        <div className="empty">{t(lang, "bookings_empty")}</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t(lang, "customer_name")}</th>
                <th>{t(lang, "nav_services")}</th>
                <th>{t(lang, "customer_phone")}</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>{a.customer_name}</td>
                  <td>{a.service_name}</td>
                  <td dir="ltr">{a.customer_phone}</td>
                  <td dir="ltr">
                    {new Date(a.start_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td>
                    <div className="toolbar">
                      <button className="btn ghost sm" onClick={() => setBookingStatus(a.id, "completed")}>
                        {t(lang, "booking_status_completed")}
                      </button>
                      <button className="btn ghost sm" onClick={() => setBookingStatus(a.id, "no_show")}>
                        {t(lang, "booking_status_no_show")}
                      </button>
                      <button className="btn danger sm" onClick={() => setBookingStatus(a.id, "cancelled")}>
                        {t(lang, "cancel")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ManualBookingForm({
  lang,
  services,
  staff,
  onDone,
}: {
  lang: Lang;
  services: Service[];
  staff: StaffMember[];
  onDone: () => void;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [staffId, setStaffId] = useState("");
  const [startAtLocal, setStartAtLocal] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await addManualBooking({
      serviceId,
      staffId: staffId || null,
      startAtLocal,
      customerName: name,
      customerPhone: phone,
      customerEmail: email,
      notes,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error as TKey);
      return;
    }
    onDone();
  }

  return (
    <form className="card" onSubmit={handleSubmit}>
      <div className="grid2">
        <div className="field">
          <label htmlFor="m_service">{t(lang, "nav_services")}</label>
          <select id="m_service" value={serviceId} onChange={(e) => setServiceId(e.target.value)} required>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="m_staff">{t(lang, "nav_staff")}</label>
          <select id="m_staff" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">{t(lang, "book_any_staff")}</option>
            {staff
              .filter((m) => m.role === "staff")
              .map((m) => (
                <option key={m.membership_id} value={m.membership_id}>
                  {staffOwnerLabel(m, lang)}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="m_start">{t(lang, "book_date_step")}</label>
        <input
          id="m_start"
          type="datetime-local"
          dir="ltr"
          required
          value={startAtLocal}
          onChange={(e) => setStartAtLocal(e.target.value)}
        />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="m_name">{t(lang, "customer_name")}</label>
          <input id="m_name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="m_phone">{t(lang, "customer_phone")}</label>
          <input id="m_phone" dir="ltr" required value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="m_email">{t(lang, "customer_email")}</label>
        <input id="m_email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="m_notes">{t(lang, "booking_notes")}</label>
        <textarea id="m_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {error && <p className="error-text">{t(lang, error)}</p>}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? t(lang, "loading") : t(lang, "save")}
      </button>
    </form>
  );
}
