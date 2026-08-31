"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { todayYMD, intlLocale } from "@/lib/date";
import type { Appointment, Service, StaffMember } from "@/lib/types";
import { staffOwnerLabel } from "@/lib/staffLabel";
import { DateField } from "@/components/DateTimeField";
import { setBookingStatus, addManualBooking, fetchOwnerSlotsAction } from "./actions";

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
  const router = useRouter();

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
          timezone={timezone}
          onDone={() => {
            setShowForm(false);
            // revalidatePath() in the action does not repaint a route
            // reached through a plain handler, so the new booking would
            // sit invisible until a manual reload.
            router.refresh();
          }}
        />
      )}

      <BookingSection title={t(lang, "bookings_today")} lang={lang} rows={todays} />
      <BookingSection title={t(lang, "bookings_upcoming")} lang={lang} rows={upcoming} />
    </div>
  );
}

function BookingSection({ title, lang, rows }: { title: string; lang: Lang; rows: Appointment[] }) {
  const router = useRouter();

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
                    {new Date(a.start_at).toLocaleString(intlLocale(lang), {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td>
                    <div className="toolbar">
                      <button className="btn ghost sm" onClick={async () => { await setBookingStatus(a.id, "completed"); router.refresh(); }}>
                        {t(lang, "booking_status_completed")}
                      </button>
                      <button className="btn ghost sm" onClick={async () => { await setBookingStatus(a.id, "no_show"); router.refresh(); }}>
                        {t(lang, "booking_status_no_show")}
                      </button>
                      <button className="btn danger sm" onClick={async () => { await setBookingStatus(a.id, "cancelled"); router.refresh(); }}>
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
  timezone,
  onDone,
}: {
  lang: Lang;
  services: Service[];
  staff: StaffMember[];
  timezone: string;
  onDone: () => void;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(todayYMD(timezone));
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [conflictPending, setConflictPending] = useState(false);

  // Reload availability whenever the service, staff or day changes —
  // each of those changes which slots are actually bookable.
  useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;
    setSlotsLoading(true);
    setStartAt(null);
    fetchOwnerSlotsAction(serviceId, date, staffId || null)
      .then((s) => {
        if (cancelled) return;
        setSlots(s);
        setSlotsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSlots([]);
        setSlotsLoading(false);
        setError("error_generic");
      });
    return () => {
      cancelled = true;
    };
  }, [serviceId, staffId, date]);

  async function submit(allowOverlap: boolean) {
    if (!startAt) return;
    setPending(true);
    setError(null);
    setConflictPending(false);
    const result = await addManualBooking({
      serviceId,
      staffId: staffId || null,
      startAt,
      customerName: name,
      customerPhone: phone,
      customerEmail: email,
      notes,
      allowOverlap,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error as TKey);
      // Reception is booking on the customer's behalf and can simply ask
      // "is this for someone else?" — so the override is offered here for
      // the same reason it is offered to the customer.
      if (result.error === "book_customer_conflict") {
        setConflictPending(true);
      }
      return;
    }
    onDone();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submit(false);
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
        <label htmlFor="m_date">{t(lang, "book_date_step")}</label>
        <DateField lang={lang} value={date} onChange={setDate} />
      </div>
      {/* The same availability grid the customer sees, rather than a free
          datetime field: book_appointment rejects out-of-hours and taken
          times anyway, so typing one only ever produced an error. Times
          render in the ORG timezone, not the browser's, so an owner who
          is travelling does not read the wrong hour. */}
      {slotsLoading ? (
        <p className="hint">{t(lang, "loading")}</p>
      ) : slots.length === 0 ? (
        <p className="hint">{t(lang, "book_no_slots")}</p>
      ) : (
        <div className="slot-grid">
          {slots.map((slotIso) => (
            <button
              key={slotIso}
              type="button"
              className={`slot-btn ${startAt === slotIso ? "selected" : ""}`}
              onClick={() => setStartAt(slotIso)}
            >
              {new Date(slotIso).toLocaleTimeString(intlLocale(lang), {
                hour: "numeric",
                minute: "2-digit",
                timeZone: timezone,
              })}
            </button>
          ))}
        </div>
      )}
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
      {conflictPending && (
        <button
          type="button"
          className="btn ghost"
          style={{ marginBottom: 10 }}
          disabled={pending}
          onClick={() => void submit(true)}
        >
          {t(lang, "book_anyway")}
        </button>
      )}
      <button type="submit" className="btn" disabled={pending || !startAt}>
        {pending ? t(lang, "loading") : t(lang, "save")}
      </button>
    </form>
  );
}
