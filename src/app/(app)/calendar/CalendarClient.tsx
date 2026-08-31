"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Lang, type TKey } from "@/lib/i18n";
import {
  addDaysYMD,
  dateFromYMD,
  intlLocale,
  localMinutes,
  localYMD,
  weekdayIndex,
  weekYMDs,
} from "@/lib/date";
import type { BookingStatus, BusinessHours } from "@/lib/types";
import { setBookingStatus, fetchOwnerSlotsAction, rescheduleBookingAction } from "../bookings/actions";
import { DateField } from "@/components/DateTimeField";
import { todayYMD } from "@/lib/date";

export type CalendarBooking = {
  id: string;
  serviceId: string;
  serviceName: string;
  price: number | null;
  staffId: string | null;
  staffName: string | null;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  notes: string | null;
};

// Pixels per minute of the working day. 1.25 keeps a 12-hour day inside
// about two screens while leaving a 30-minute appointment tall enough to
// read — at 1.1 the 30-minute blocks clipped their own text.
const PX_PER_MIN = 1.25;
// Three stacked lines need about 53px, so anything under ~50 minutes
// drops the service name and puts the time beside the customer instead.
// Measured, not guessed: at 40 a 45-minute booking still clipped its
// third line halfway through the glyphs.
const SHORT_BLOCK_MIN = 50;
const MIN_BLOCK_MIN = 22;

export function CalendarClient({
  lang,
  timezone,
  today,
  day,
  view,
  businessHours,
  bookings,
  staff,
}: {
  lang: Lang;
  timezone: string;
  today: string;
  day: string;
  view: "day" | "week";
  businessHours: BusinessHours;
  bookings: CalendarBooking[];
  staff: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<CalendarBooking | null>(null);
  const locale = intlLocale(lang);

  const go = (d: string, v: "day" | "week") => router.push(`/calendar?d=${d}&v=${v}`);

  // Bucket by the CLINIC's local date. Slicing the ISO string would
  // bucket by UTC and drop a late appointment onto the day before.
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarBooking[]>();
    for (const b of bookings) {
      const k = localYMD(b.startAt, timezone);
      const list = m.get(k);
      if (list) list.push(b);
      else m.set(k, [b]);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.startAt.localeCompare(b.startAt));
    }
    return m;
  }, [bookings, timezone]);

  const dayBookings = byDay.get(day) ?? [];
  const booked = dayBookings.filter((b) => b.status === "booked");
  const cancelled = dayBookings.filter((b) => b.status === "cancelled");
  const done = dayBookings.filter((b) => b.status === "completed");

  // Only counts what is still on the books. A price of null means the
  // service has no price set — those are counted separately rather than
  // added as zero, so the total never understates the day silently.
  const earning = [...booked, ...done];
  const priced = earning.filter((b) => b.price != null);
  const total = priced.reduce((sum, b) => sum + Number(b.price), 0);
  const unpriced = earning.length - priced.length;

  const dayLabel = (ymd: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: "UTC", ...opts }).format(dateFromYMD(ymd));

  return (
    <>
      <div className="agenda-bar">
        <div className="agenda-nav">
          <button
            className="btn ghost sm"
            aria-label={t(lang, "cal_prev")}
            onClick={() => go(addDaysYMD(day, view === "week" ? -7 : -1), view)}
          >
            ‹
          </button>
          <button className="btn ghost sm" onClick={() => go(today, view)}>
            {t(lang, "cal_today")}
          </button>
          <button
            className="btn ghost sm"
            aria-label={t(lang, "cal_next")}
            onClick={() => go(addDaysYMD(day, view === "week" ? 7 : 1), view)}
          >
            ›
          </button>
          <strong className="agenda-title">
            {view === "day"
              ? dayLabel(day, { weekday: "long", day: "numeric", month: "long" })
              : `${dayLabel(weekYMDs(day, timezone)[0], { day: "numeric", month: "short" })} — ${dayLabel(
                  weekYMDs(day, timezone)[6],
                  { day: "numeric", month: "short" }
                )}`}
          </strong>
        </div>
        <div className="agenda-views">
          <button className={`btn sm ${view === "day" ? "" : "ghost"}`} onClick={() => go(day, "day")}>
            {t(lang, "cal_view_day")}
          </button>
          <button className={`btn sm ${view === "week" ? "" : "ghost"}`} onClick={() => go(day, "week")}>
            {t(lang, "cal_view_week")}
          </button>
        </div>
      </div>

      {view === "day" && (
        <div className="agenda-stats">
          <Stat label={t(lang, "cal_stat_booked")} value={booked.length.toLocaleString(locale)} tone="good" />
          <Stat label={t(lang, "cal_stat_done")} value={done.length.toLocaleString(locale)} />
          <Stat label={t(lang, "cal_stat_cancelled")} value={cancelled.length.toLocaleString(locale)} tone={cancelled.length ? "bad" : undefined} />
          <Stat
            label={t(lang, "cal_stat_value")}
            value={`${total.toLocaleString(locale, { maximumFractionDigits: 2 })} ${t(lang, "currency")}`}
            hint={unpriced > 0 ? t(lang, "cal_unpriced", { n: unpriced.toLocaleString(locale) }) : undefined}
          />
        </div>
      )}

      {view === "day" ? (
        <DayGrid
          lang={lang}
          timezone={timezone}
          day={day}
          businessHours={businessHours}
          bookings={dayBookings}
          staff={staff}
          onOpen={setOpen}
        />
      ) : (
        <WeekGrid
          lang={lang}
          timezone={timezone}
          day={day}
          today={today}
          byDay={byDay}
          onPickDay={(d) => go(d, "day")}
          onOpen={setOpen}
        />
      )}

      {open && (
        <BookingSheet
          lang={lang}
          timezone={timezone}
          booking={open}
          onClose={() => setOpen(null)}
          onChanged={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
  hint?: string;
}) {
  return (
    <div className="agenda-stat">
      <span className="cs-label">{label}</span>
      <strong className={`cs-value ${tone ?? ""}`}>{value}</strong>
      {hint && <span className="cs-hint">{hint}</span>}
    </div>
  );
}

function DayGrid({
  lang,
  timezone,
  day,
  businessHours,
  bookings,
  staff,
  onOpen,
}: {
  lang: Lang;
  timezone: string;
  day: string;
  businessHours: BusinessHours;
  bookings: CalendarBooking[];
  staff: { id: string; name: string }[];
  onOpen: (b: CalendarBooking) => void;
}) {
  const locale = intlLocale(lang);

  // The axis follows the clinic's opening hours, then stretches to cover
  // anything booked outside them — a booking must never be invisible
  // because it sits past closing time.
  const hours = businessHours[String(weekdayIndex(day, timezone))];
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  let from = hours && !hours.closed ? toMin(hours.open) : 9 * 60;
  let to = hours && !hours.closed ? toMin(hours.close) : 21 * 60;
  for (const b of bookings) {
    from = Math.min(from, localMinutes(b.startAt, timezone));
    to = Math.max(to, localMinutes(b.startAt, timezone) + duration(b));
  }
  from = Math.floor(from / 60) * 60;
  to = Math.ceil(to / 60) * 60;
  if (to <= from) to = from + 60;

  const rows: number[] = [];
  for (let m = from; m <= to; m += 60) rows.push(m);

  // One column per staff member, plus a shared column for bookings made
  // without picking anyone — those are held against the whole clinic.
  const unassigned = bookings.filter((b) => !b.staffId);
  const columns = [
    ...staff.map((s) => ({ id: s.id, name: s.name, list: bookings.filter((b) => b.staffId === s.id) })),
    ...(unassigned.length > 0 || staff.length === 0
      ? [{ id: "__none__", name: t(lang, "book_any_staff"), list: unassigned }]
      : []),
  ];

  if (columns.length === 0) {
    return <div className="card empty">{t(lang, "cal_no_staff")}</div>;
  }

  const height = (to - from) * PX_PER_MIN;

  return (
    <div className="card agenda-card">
      <div className="agenda-scroll">
        <div className="agenda-grid" style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(150px, 1fr))` }}>
          <div className="agenda-corner" />
          {columns.map((c) => (
            <div key={c.id} className="agenda-colhead">
              {c.name}
            </div>
          ))}

          <div className="agenda-axis" style={{ height }}>
            {rows.map((m) => (
              <div key={m} className="agenda-hour" style={{ top: (m - from) * PX_PER_MIN }}>
                <span>
                  {new Intl.DateTimeFormat(locale, {
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: "UTC",
                  }).format(new Date(Date.UTC(2000, 0, 1, Math.floor(m / 60) % 24, m % 60)))}
                </span>
              </div>
            ))}
          </div>

          {columns.map((c) => (
            <div key={c.id} className="agenda-col" style={{ height }}>
              {rows.map((m) => (
                <div key={m} className="agenda-line" style={{ top: (m - from) * PX_PER_MIN }} />
              ))}
              {c.list.map((b) => {
                const startMin = localMinutes(b.startAt, timezone);
                const mins = duration(b);
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`agenda-ev ${b.status} ${mins < SHORT_BLOCK_MIN ? "short" : ""}`}
                    style={{
                      top: (startMin - from) * PX_PER_MIN,
                      height: Math.max(mins, MIN_BLOCK_MIN) * PX_PER_MIN - 2,
                    }}
                    onClick={() => onOpen(b)}
                  >
                    <span className="ce-time" dir="ltr">
                      {clock(b.startAt, timezone, locale)}
                    </span>
                    <span className="ce-name">{b.customerName}</span>
                    <span className="ce-svc">{b.serviceName}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {bookings.length === 0 && <div className="empty">{t(lang, "cal_empty_day")}</div>}
    </div>
  );
}

function WeekGrid({
  lang,
  timezone,
  day,
  today,
  byDay,
  onPickDay,
  onOpen,
}: {
  lang: Lang;
  timezone: string;
  day: string;
  today: string;
  byDay: Map<string, CalendarBooking[]>;
  onPickDay: (d: string) => void;
  onOpen: (b: CalendarBooking) => void;
}) {
  const locale = intlLocale(lang);
  const days = weekYMDs(day, timezone);

  return (
    <div className="card agenda-card">
      <div className="agenda-scroll">
        <div className="agenda-week">
          {days.map((d) => {
            const list = (byDay.get(d) ?? []).filter((b) => b.status !== "cancelled");
            return (
              <div key={d} className={`cw-day ${d === today ? "is-today" : ""} ${d === day ? "is-sel" : ""}`}>
                <button type="button" className="cw-head" onClick={() => onPickDay(d)}>
                  <span className="cw-dow">
                    {new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(dateFromYMD(d))}
                  </span>
                  <span className="cw-num">
                    {new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" }).format(dateFromYMD(d))}
                  </span>
                  <span className="cw-count">{list.length.toLocaleString(locale)}</span>
                </button>
                <div className="cw-list">
                  {list.map((b) => (
                    <button key={b.id} type="button" className={`cw-ev ${b.status}`} onClick={() => onOpen(b)}>
                      <span dir="ltr">{clock(b.startAt, timezone, locale)}</span>
                      <span>{b.customerName}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BookingSheet({
  lang,
  timezone,
  booking,
  onClose,
  onChanged,
}: {
  lang: Lang;
  timezone: string;
  booking: CalendarBooking;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(() => localYMD(booking.startAt, timezone));
  const [slots, setSlots] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<TKey | null>(null);
  const locale = intlLocale(lang);

  async function loadSlots(d: string) {
    setPending(true);
    setError(null);
    setPicked(null);
    try {
      setSlots(await fetchOwnerSlotsAction(booking.serviceId, d, booking.staffId));
    } catch {
      // "no times" and "the lookup failed" must not look the same.
      setSlots(null);
      setError("error_generic");
    } finally {
      setPending(false);
    }
  }

  async function mark(status: BookingStatus) {
    setPending(true);
    await setBookingStatus(booking.id, status);
    setPending(false);
    onChanged();
  }

  return (
    <div className="agenda-sheet-wrap" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="agenda-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="agenda-sheet-head">
          <strong>{booking.customerName}</strong>
          <button className="btn ghost sm" onClick={onClose} aria-label={t(lang, "close")}>
            ✕
          </button>
        </div>
        <p className="hint" dir="ltr" style={{ textAlign: "start" }}>
          {clock(booking.startAt, timezone, locale)} – {clock(booking.endAt, timezone, locale)}
        </p>
        <p>{booking.serviceName}</p>
        {booking.staffName && <p className="hint">{booking.staffName}</p>}
        <p dir="ltr" style={{ textAlign: "start" }}>
          <a href={`tel:${booking.customerPhone}`}>{booking.customerPhone}</a>
          {" · "}
          <a
            href={`https://wa.me/${waNumber(booking.customerPhone)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            WhatsApp
          </a>
        </p>
        {booking.notes && <p className="hint">{booking.notes}</p>}
        <p style={{ margin: "8px 0" }}>
          <span
            className={`chip ${
              booking.status === "booked" ? "good" : booking.status === "cancelled" ? "bad" : "neutral"
            }`}
          >
            {t(lang, `booking_status_${booking.status}` as TKey)}
          </span>
        </p>
        {booking.status === "booked" && !moving && (
          <div className="toolbar">
            <button
              className="btn ghost sm"
              disabled={pending}
              onClick={() => {
                setMoving(true);
                void loadSlots(date);
              }}
            >
              {t(lang, "resched_cta")}
            </button>
            <button className="btn ghost sm" disabled={pending} onClick={() => mark("completed")}>
              {t(lang, "booking_status_completed")}
            </button>
            <button className="btn ghost sm" disabled={pending} onClick={() => mark("no_show")}>
              {t(lang, "booking_status_no_show")}
            </button>
            <button className="btn danger sm" disabled={pending} onClick={() => mark("cancelled")}>
              {t(lang, "cancel")}
            </button>
          </div>
        )}

        {booking.status === "booked" && moving && (
          <div className="resched">
            <p style={{ fontWeight: 700, marginBottom: 8 }}>{t(lang, "resched_title")}</p>
            <DateField
              lang={lang}
              value={date}
              min={todayYMD(timezone)}
              onChange={(d) => {
                setDate(d);
                void loadSlots(d);
              }}
            />
            {pending && <p className="hint">{t(lang, "loading")}</p>}
            {!pending && slots !== null && slots.length === 0 && (
              <p className="hint">{t(lang, "book_no_slots")}</p>
            )}
            {!pending && slots !== null && slots.length > 0 && (
              <div className="slot-grid" style={{ marginTop: 10 }}>
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`slot-btn ${picked === s ? "selected" : ""}`}
                    onClick={() => setPicked(s)}
                  >
                    {clock(s, timezone, locale)}
                  </button>
                ))}
              </div>
            )}
            {error && <p className="error-text">{t(lang, error)}</p>}
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button
                className="btn sm"
                disabled={!picked || pending}
                onClick={async () => {
                  if (!picked) return;
                  setPending(true);
                  setError(null);
                  const r = await rescheduleBookingAction(booking.id, picked);
                  setPending(false);
                  if (!r.ok) {
                    setError(r.error as TKey);
                    if (r.error === "book_slot_taken") void loadSlots(date);
                    return;
                  }
                  onChanged();
                }}
              >
                {t(lang, "resched_confirm")}
              </button>
              <button className="btn ghost sm" disabled={pending} onClick={() => setMoving(false)}>
                {t(lang, "resched_keep")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function duration(b: CalendarBooking): number {
  return Math.max(5, Math.round((new Date(b.endAt).getTime() - new Date(b.startAt).getTime()) / 60000));
}

function clock(iso: string, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// wa.me wants digits only, in international form. Jordanian numbers are
// stored as the customer typed them — usually 07XXXXXXXX — so the local
// trunk 0 is swapped for the country code.
function waNumber(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("00962")) return d.slice(2);
  if (d.startsWith("962")) return d;
  if (d.startsWith("0")) return `962${d.slice(1)}`;
  return d;
}
