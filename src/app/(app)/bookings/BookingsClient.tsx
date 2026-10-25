"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { normalizePhone } from "@/lib/phone";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { todayYMD, intlLocale } from "@/lib/date";
import type { Appointment, BookingStatus, Service, StaffMember } from "@/lib/types";
import { staffOwnerLabel } from "@/lib/staffLabel";
import { DateField } from "@/components/DateTimeField";
import { setBookingStatus, addManualBooking, fetchOwnerSlotsAction, addManualSeries, type SeriesBookingResult } from "./actions";
import { SERIES_EVERY_WEEKS, SERIES_MAX, SERIES_MIN, proposeSeries, seriesDays, type SeriesProposal } from "@/lib/recurrence";
import { holderKey, type Holder, type VisitPackageState } from "@/lib/packages";

export function BookingsClient({
  lang,
  appointments,
  services,
  staff,
  timezone,
  prefill = null,
  holders = {},
}: {
  lang: Lang;
  appointments: Appointment[];
  services: Service[];
  staff: StaffMember[];
  timezone: string;
  /** Opens the manual form filled for one customer (customer file). */
  prefill?: { name: string; phone: string; email: string } | null;
  /** Usable packages by phone + service (0064 list_package_holders). */
  holders?: Record<string, Holder>;
}) {
  const [showForm, setShowForm] = useState(prefill !== null);
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
          prefill={prefill}
          onDone={() => {
            setShowForm(false);
            // revalidatePath() in the action does not repaint a route
            // reached through a plain handler, so the new booking would
            // sit invisible until a manual reload.
            router.refresh();
          }}
        />
      )}

      <BookingSection title={t(lang, "bookings_today")} lang={lang} rows={todays} timezone={timezone} holders={holders} />
      <BookingSection title={t(lang, "bookings_upcoming")} lang={lang} rows={upcoming} timezone={timezone} holders={holders} />
    </div>
  );
}

function BookingSection({
  title,
  lang,
  rows,
  timezone,
  holders,
}: {
  title: string;
  lang: Lang;
  rows: Appointment[];
  holders: Record<string, Holder>;
  /** The CLINIC's timezone. Without it this renders UTC on the server and
   *  local time in the browser — a hydration mismatch that silently kills
   *  the status buttons in these same rows. */
  timezone: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<TKey | null>(null);
  // Said once after "completed" drew a session: the row itself leaves the
  // list, so this is the only place the desk sees it.
  const [drawn, setDrawn] = useState<{ customer: string; pkg: VisitPackageState } | null>(null);

  async function mark(a: Appointment, status: BookingStatus) {
    const res = await setBookingStatus(a.id, status);
    if (!res.ok) {
      setError("error_generic");
      return;
    }
    setError(null);
    setDrawn(res.package ? { customer: a.customer_name, pkg: res.package } : null);
    router.refresh();
  }

  return (
    <div className="card">
      <p style={{ fontWeight: 700, marginBottom: 10 }}>{title}</p>
      {error && <p className="error-text">{t(lang, error)}</p>}
      {drawn && (
        <p className="pkg-drawn">
          {t(lang, "pkg_drawn_notice", {
            customer: drawn.customer,
            name: drawn.pkg.name,
            left: drawn.pkg.remaining.toLocaleString(intlLocale(lang)),
          })}
        </p>
      )}
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
                  <td>
                    <Link href={`/customers/${encodeURIComponent(normalizePhone(a.customer_phone))}`} className="cust-link">
                      {a.customer_name}
                    </Link>
                  </td>
                  <td>
                    {a.service_name}
                    {(() => {
                      const h = holders[holderKey(normalizePhone(a.customer_phone), a.service_id)];
                      return h ? (
                        <span className="chip good" title={h.name}>
                          {t(lang, "pkg_holder_chip", { left: h.remaining.toLocaleString(intlLocale(lang)) })}
                        </span>
                      ) : null;
                    })()}
                  </td>
                  <td dir="ltr">{a.customer_phone}</td>
                  <td dir="ltr">
                    {new Date(a.start_at).toLocaleString(intlLocale(lang), {
                      timeZone: timezone,
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td>
                    <div className="toolbar">
                      <button className="btn ghost sm" onClick={() => mark(a, "completed")}>
                        {t(lang, "booking_status_completed")}
                      </button>
                      <button className="btn ghost sm" onClick={() => mark(a, "no_show")}>
                        {t(lang, "booking_status_no_show")}
                      </button>
                      <button className="btn danger sm" onClick={() => mark(a, "cancelled")}>
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
  prefill = null,
}: {
  lang: Lang;
  services: Service[];
  staff: StaffMember[];
  timezone: string;
  onDone: () => void;
  prefill?: { name: string; phone: string; email: string } | null;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(todayYMD(timezone));
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [startAt, setStartAt] = useState<string | null>(null);
  const [name, setName] = useState(prefill?.name ?? "");
  const [phone, setPhone] = useState(prefill?.phone ?? "");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TKey | null>(null);
  const [conflictPending, setConflictPending] = useState(false);
  // A series (0067): proposed in full, booked only once confirmed.
  const [repeat, setRepeat] = useState(false);
  const [everyWeeks, setEveryWeeks] = useState(2);
  const [count, setCount] = useState(4);
  const [proposal, setProposal] = useState<SeriesProposal[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [seriesResult, setSeriesResult] = useState<SeriesBookingResult | null>(null);
  const locale = intlLocale(lang);
  const dayName = (ymd: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
      new Date(`${ymd}T12:00:00Z`)
    );
  const clockOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: timezone });

  // Any change to what the series is built from makes the proposal stale.
  useEffect(() => {
    setProposal(null);
  }, [serviceId, staffId, date, startAt, everyWeeks, count, repeat]);

  async function preview() {
    if (!startAt) return;
    setPreviewing(true);
    setError(null);
    try {
      const days = seriesDays(date, everyWeeks, count);
      const slotsByDay = await Promise.all(
        days.map((d, i) => (i === 0 ? Promise.resolve([startAt]) : fetchOwnerSlotsAction(serviceId, d, staffId || null)))
      );
      setProposal(proposeSeries(days, startAt, slotsByDay, timezone));
    } catch {
      // "no time that day" and "the lookup failed" must not look the same.
      setProposal(null);
      setError("error_generic");
    } finally {
      setPreviewing(false);
    }
  }

  const chosenTimes = (proposal ?? []).filter((x) => x.include && x.startAt).map((x) => x.startAt as string);

  async function submitSeries() {
    if (chosenTimes.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const r = await addManualSeries({
        serviceId,
        staffId: staffId || null,
        startAts: chosenTimes,
        customerName: name,
        customerPhone: phone,
        customerEmail: email,
        notes,
      });
      if (r.results.every((x) => x.ok)) {
        onDone();
        return;
      }
      setSeriesResult(r);
    } catch {
      setError("error_generic");
    } finally {
      setPending(false);
    }
  }

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
    if (repeat) void submitSeries();
    else void submit(false);
  }

  // What happened to each time of the series, when not all were booked.
  if (seriesResult) {
    const booked = seriesResult.results.filter((x) => x.ok).length;
    return (
      <div className="card">
        <p style={{ fontWeight: 700, marginBottom: 8 }}>
          {t(lang, "series_result", { ok: booked.toLocaleString(locale), n: seriesResult.results.length.toLocaleString(locale) })}
        </p>
        <ul className="series-list">
          {seriesResult.results.map((x) => (
            <li key={x.startAt}>
              <span>
                {new Date(x.startAt).toLocaleString(locale, { timeZone: timezone, dateStyle: "full", timeStyle: "short" })}
              </span>
              {x.ok ? (
                <span className="chip good">{t(lang, "series_booked")}</span>
              ) : (
                <span className="chip bad">{t(lang, (x.error ?? "error_generic") as TKey)}</span>
              )}
            </li>
          ))}
        </ul>
        <button type="button" className="btn" style={{ marginTop: 10 }} onClick={onDone}>
          {t(lang, "series_done")}
        </button>
      </div>
    );
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
                <option key={m.membership_id} value={m.membership_id ?? ""}>
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
      <div className="field" style={{ marginTop: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
          {t(lang, "series_toggle")}
        </label>
      </div>
      {repeat && (
        <div className="series-box">
          <div className="grid2">
            <div className="field">
              <label htmlFor="m_every">{t(lang, "series_every")}</label>
              <select id="m_every" value={everyWeeks} onChange={(e) => setEveryWeeks(Number(e.target.value))}>
                {SERIES_EVERY_WEEKS.map((w) => (
                  <option key={w} value={w}>
                    {t(lang, w === 1 ? "series_every_week" : w === 2 ? "series_every_two_weeks" : "series_every_n_weeks", {
                      n: w.toLocaleString(locale),
                    })}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="m_count">{t(lang, "series_count")}</label>
              <select id="m_count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {Array.from({ length: SERIES_MAX - SERIES_MIN + 1 }, (_, i) => i + SERIES_MIN).map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString(locale)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button type="button" className="btn ghost sm" disabled={!startAt || previewing} onClick={() => void preview()}>
            {previewing ? t(lang, "loading") : t(lang, "series_preview")}
          </button>
          {!startAt && <p className="hint" style={{ marginTop: 6 }}>{t(lang, "series_pick_first")}</p>}
          {proposal && (
            <ul className="series-list">
              {proposal.map((x, i) => (
                <li key={x.day}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={x.include}
                      disabled={!x.startAt || i === 0}
                      onChange={(e) =>
                        setProposal((prev) =>
                          prev ? prev.map((y, j) => (j === i ? { ...y, include: e.target.checked } : y)) : prev
                        )
                      }
                    />
                    <span>
                      {dayName(x.day)}
                      {x.startAt && <> · {clockOf(x.startAt)}</>}
                    </span>
                  </label>
                  {!x.startAt ? (
                    <span className="chip bad">{t(lang, "series_no_time")}</span>
                  ) : x.exact ? (
                    <span className="chip good">{t(lang, "series_same_time")}</span>
                  ) : (
                    <span className="chip warn">{t(lang, "series_other_time")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="hint" style={{ marginTop: 6 }}>{t(lang, "series_hint")}</p>
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
      <button type="submit" className="btn" disabled={pending || !startAt || (repeat && chosenTimes.length === 0)}>
        {pending
          ? t(lang, "loading")
          : repeat
            ? proposal
              ? t(lang, "series_book_n", { n: chosenTimes.length.toLocaleString(locale) })
              : t(lang, "series_preview_first")
            : t(lang, "save")}
      </button>
    </form>
  );
}
