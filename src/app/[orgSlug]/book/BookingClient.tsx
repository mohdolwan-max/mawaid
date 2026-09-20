"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t, type Lang, type TKey } from "@/lib/i18n";
import type { PublicService, PublicStaff } from "@/lib/publicOrg";
import { staffPublicLabel } from "@/lib/staffLabel";
import { DateField } from "@/components/DateTimeField";
import { ReminderOptIn } from "@/components/marketplace/ReminderOptIn";
import { fetchStaffAction, fetchSlotsAction, submitBookingAction } from "./actions";
import { intlLocale } from "@/lib/date";
import { isValidPhone, formatPhoneForDisplay, normalizePhone } from "@/lib/phone";

type Step = "service" | "staff" | "slot" | "contact" | "done";

const STEP_ORDER: Step[] = ["service", "staff", "slot", "contact"];
const STEP_LABELS: TKey[] = ["step_service", "step_staff", "step_time", "step_info"];

// The clinic's today. A visitor in another timezone was offered THEIR
// today as the first bookable day, and read every slot time on their own
// clock — a customer in Dubai booking a clinic in Amman saw 7:00 for a
// 6:00 appointment.
function todayISO(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

function StepsBar({ lang, step }: { lang: Lang; step: Step }) {
  if (step === "done") return null;
  const current = STEP_ORDER.indexOf(step);

  return (
    <div className="steps-bar">
      {STEP_ORDER.map((s, i) => (
        <div key={s} style={{ display: "contents" }}>
          {i > 0 && <div className={`connector ${i <= current ? "done" : ""}`} />}
          <div className={`step ${i === current ? "active" : i < current ? "done" : ""}`}>
            <span className="dot">{i < current ? "✓" : i + 1}</span>
            <span className="lbl">{t(lang, STEP_LABELS[i])}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BookingClient({
  lang,
  orgSlug,
  services,
  defaults,
  timezone,
  initialServiceIds = [],
}: {
  lang: Lang;
  orgSlug: string;
  services: PublicService[];
  /** The CLINIC's timezone: every time on this screen is its clock. */
  timezone: string;
  defaults: { name: string; phone: string; email: string } | null;
  /** Services already chosen on the clinic page, validated server-side. */
  initialServiceIds?: string[];
}) {
  // Arriving with services picked on the clinic page: start with them
  // chosen and on the staff step, instead of asking for them again.
  const initialChosen = initialServiceIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is PublicService => s !== undefined);
  const [step, setStep] = useState<Step>(initialChosen.length > 0 ? "staff" : "service");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

  // A visit can be several services back to back (dental then
  // dermatology at a medical centre). Order matters — they are booked in
  // the order chosen, each starting when the previous one ends.
  const [chosen, setChosen] = useState<PublicService[]>(initialChosen);
  const service = chosen[0] ?? null;
  const [staffOptions, setStaffOptions] = useState<PublicStaff[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);

  const [date, setDate] = useState(todayISO(timezone));
  const [slots, setSlots] = useState<string[]>([]);
  // "Any staff" + a real roster renders the Wddk-style grouped view:
  // one block of times PER specialist instead of one anonymous grid.
  // Picking a time there also picks its specialist (kept separately so
  // the explicit staff-step choice — staffId — stays untouched and the
  // fetch effect below doesn't re-fire and wipe the selection).
  const [staffSlots, setStaffSlots] = useState<{ staff: PublicStaff; slots: string[] }[]>([]);
  const [pickedStaffForSlot, setPickedStaffForSlot] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [name, setName] = useState(defaults?.name ?? "");
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [notes, setNotes] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const [cancelToken, setCancelToken] = useState<string | null>(null);
  // Set when the server reports the customer already holds an
  // overlapping appointment. Not a hard block: one phone legitimately
  // books for a whole family, so they get to confirm and continue.
  const [conflictPending, setConflictPending] = useState(false);

  // Times as the clinic keeps them, in the page's language.
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(intlLocale(lang), {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    });

  function toggleService(s: PublicService) {
    setError(null);
    setChosen((prev) =>
      prev.some((c) => c.id === s.id) ? prev.filter((c) => c.id !== s.id) : [...prev, s]
    );
  }

  // One list of times, whoever they are with. When the customer picked
  // "any available", each time carries the first specialist who has it;
  // an explicitly chosen specialist has one list anyway.
  const offered: { iso: string; staffId: string | null }[] =
    staffSlots.length > 0
      ? Object.values(
          staffSlots.reduce<Record<string, { iso: string; staffId: string | null }>>((acc, g) => {
            for (const iso of g.slots) {
              if (!acc[iso]) acc[iso] = { iso, staffId: g.staff.membership_id };
            }
            return acc;
          }, {})
        ).sort((a, b) => a.iso.localeCompare(b.iso))
      : slots.map((iso) => ({ iso, staffId: staffId }));

  const pickedStaff =
    staffOptions.find((s) => s.membership_id === (pickedStaffForSlot ?? staffId)) ?? null;
  const withStaffLabel = pickedStaff ? staffPublicLabel(pickedStaff, lang) : null;

  function goToStaff() {
    if (chosen.length === 0) return;
    setStaffId(null);
    setError(null);
    setStep("staff");
  }

  // Staff for the FIRST service, loaded whenever the staff step shows.
  // This used to run inside goToStaff(), which a visit arriving with
  // services preselected never passes through; that path would only
  // have offered "any available staff". Staff choice applies to the
  // whole visit, so only people who can perform the first service are
  // offered; anyone else could not start it.
  const firstServiceId = chosen[0]?.id ?? null;
  useEffect(() => {
    if (step !== "staff" || !firstServiceId) return;
    let cancelled = false;
    fetchStaffAction(orgSlug, firstServiceId)
      .then((s) => {
        if (!cancelled) setStaffOptions(s);
      })
      .catch(() => {
        // A transient network blip once left the list silently empty,
        // which reads as "this clinic has no staff". Surface it instead.
        if (!cancelled) setError("error_generic");
      });
    return () => {
      cancelled = true;
    };
  }, [step, firstServiceId, orgSlug]);

  useEffect(() => {
    if (step !== "slot" || !service) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSelectedSlot(null);
    setPickedStaffForSlot(null);
    setError(null);
    const grouped = staffId === null && staffOptions.length > 0;
    const load = grouped
      ? // One request per specialist, in parallel. Rosters are small
        // (2–10 people) and each answer is that person's real diary —
        // there is no single query that could answer this more honestly.
        Promise.all(
          staffOptions.map((st) =>
            fetchSlotsAction(orgSlug, chosen.map((c) => c.id), date, st.membership_id).then(
              (s) => ({ staff: st, slots: s })
            )
          )
        ).then((groups) => {
          if (cancelled) return;
          setStaffSlots(groups.filter((g) => g.slots.length > 0));
          setSlots([]);
          setSlotsLoading(false);
        })
      : fetchSlotsAction(orgSlug, chosen.map((c) => c.id), date, staffId).then((s) => {
          if (cancelled) return;
          setSlots(s);
          setStaffSlots([]);
          setSlotsLoading(false);
        });
    load.catch(() => {
      // Previously unhandled: a rejected fetch here left slotsLoading
      // stuck true forever — the date picker stayed, but the slot
      // grid never resolved either way, reading as a dead/blank step.
      if (cancelled) return;
      setSlots([]);
      setStaffSlots([]);
      setSlotsLoading(false);
      setError("error_generic");
    });
    return () => {
      cancelled = true;
    };
  }, [step, service, date, staffId, staffOptions, orgSlug, chosen]);

  async function submitBooking(allowOverlap: boolean) {
    if (chosen.length === 0 || !selectedSlot) return;
    // Backstopped by appointments_phone_shape (0039); this is the copy
    // that gives the customer a sentence instead of a driver error.
    if (!isValidPhone(phone)) {
      setError("phone_invalid");
      return;
    }
    if (honeypot.trim() !== "") {
      // Silently pretend it worked — don't tip off the bot.
      setCancelToken("00000000-0000-0000-0000-000000000000");
      setStep("done");
      return;
    }
    setPending(true);
    setError(null);
    setConflictPending(false);
    let result;
    try {
      result = await submitBookingAction({
        orgSlug,
        serviceIds: chosen.map((c) => c.id),
        startAt: selectedSlot,
        // A time picked inside a specialist's block IS a choice of that
        // specialist — booking it as "anyone" could land the visit with
        // somebody else even though their name sat above the button.
        staffId: staffId ?? pickedStaffForSlot,
        customerName: name,
        customerPhone: phone,
        customerEmail: email,
        notes,
        allowOverlap,
      });
    } catch {
      // Without this the button spun forever on any rejection (dropped
      // connection mid-submit), with no error and no way forward.
      // Deliberately NOT "booking failed": bookAppointment() commits
      // before anything downstream can throw, so the appointment may
      // well exist — telling the customer it failed invites a duplicate.
      setError("book_unconfirmed");
      return;
    } finally {
      setPending(false);
    }
    if (!result.ok) {
      setError(result.error as TKey);
      if (result.error === "book_slot_taken") {
        setStep("slot");
      }
      if (result.error === "book_customer_conflict") {
        setConflictPending(true);
      }
      return;
    }
    setCancelToken(result.cancelToken);
    // A guest who left the email blank saw the manage link once, on
    // this screen, and closing the tab lost the booking for good — the
    // clinic could cancel it, they could not. Keep a local pointer so
    // the same device can find it again (SavedBookings on the home
    // page). Storage failure must never break a confirmed booking.
    try {
      const saved: { token: string }[] = JSON.parse(localStorage.getItem("maw3ed_bookings") ?? "[]");
      const next = [
        { token: result.cancelToken, orgSlug, at: selectedSlot, phone: normalizePhone(phone) },
        ...saved.filter((b) => b && b.token !== result.cancelToken),
      ].slice(0, 5);
      localStorage.setItem("maw3ed_bookings", JSON.stringify(next));
    } catch {}
    setStep("done");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitBooking(false);
  }

  return (
    <div>
      <StepsBar lang={lang} step={step} />

      {step === "service" && (
        <div className="card wizard-step">
          <p style={{ fontWeight: 700, marginBottom: 4 }}>{t(lang, "book_service_step")}</p>
          <p className="hint" style={{ marginBottom: 10 }}>{t(lang, "book_multi_hint")}</p>
          {services.map((s) => {
            const picked = chosen.findIndex((c) => c.id === s.id);
            return (
              <div
                key={s.id}
                className={`service-row ${picked >= 0 ? "selected" : ""}`}
                onClick={() => toggleService(s)}
              >
                <div>
                  <strong>
                    {picked >= 0 && <span className="pick-order">{picked + 1}</span>}
                    {s.name}
                  </strong>
                  <p className="hint">
                    {s.duration_minutes} {t(lang, "minutes")}
                  </p>
                </div>
                {s.price != null && (
                  <span className="num">
                    {s.price} {t(lang, "currency")}
                  </span>
                )}
              </div>
            );
          })}
          {chosen.length > 1 && (
            <p className="hint" style={{ marginTop: 8 }}>
              {t(lang, "book_visit_total", {
                n: chosen.length,
                minutes: chosen.reduce((sum, c) => sum + c.duration_minutes, 0),
              })}
            </p>
          )}
          <div className="toolbar" style={{ marginTop: 10 }}>
            <Link href={`/${orgSlug}`} className="btn ghost">
              {t(lang, "back")}
            </Link>
            <button className="btn" disabled={chosen.length === 0} onClick={goToStaff}>
              {t(lang, "next")}
            </button>
          </div>
        </div>
      )}

      {step === "staff" && service && (
        <div className="card wizard-step">
          <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "book_staff_step")}</p>
          <div
            className={`service-row ${staffId === null ? "selected" : ""}`}
            onClick={() => setStaffId(null)}
          >
            {t(lang, "book_any_staff")}
          </div>
          {staffOptions.map((st) => (
            <div
              key={st.membership_id}
              className={`service-row ${staffId === st.membership_id ? "selected" : ""}`}
              onClick={() => setStaffId(st.membership_id)}
            >
              {staffPublicLabel(st, lang)}
            </div>
          ))}
          {error && <p className="error-text">{t(lang, error)}</p>}
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => setStep("service")}>
              {t(lang, "back")}
            </button>
            <button className="btn" onClick={() => setStep("slot")}>
              {t(lang, "next")}
            </button>
          </div>
        </div>
      )}

      {step === "slot" && service && (
        <div className="card wizard-step">
          <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "book_date_step")}</p>
          <div className="field">
            <DateField lang={lang} value={date} onChange={setDate} min={todayISO(timezone)} />
          </div>
          {slotsLoading ? (
            <p className="hint">{t(lang, "loading")}</p>
          ) : offered.length === 0 ? (
            <p className="hint">{t(lang, "book_no_slots")}</p>
          ) : (
            <>
              {/* Why the day starts when it starts. The clinic's own
                  minimum-notice rule pushes the first slot forward, and
                  without a word for it a half-empty day reads as a fully
                  booked one (reviewer, 2026-09-20). */}
              <p className="hint" style={{ marginBottom: 8 }}>
                {t(lang, "book_earliest", { time: fmtTime(offered[0].iso) })}
              </p>
              <div className="slot-grid">
                {offered.map((o) => (
                  <button
                    key={o.iso}
                    type="button"
                    className={`slot-btn ${selectedSlot === o.iso ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedSlot(o.iso);
                      setPickedStaffForSlot(o.staffId);
                    }}
                  >
                    {fmtTime(o.iso)}
                  </button>
                ))}
              </div>
              {/* Choosing "any available" used to produce one grid per
                  specialist with identical times in each. One list now,
                  and the name appears once a time is chosen. */}
              {selectedSlot && withStaffLabel && (
                <p className="hint" style={{ marginTop: 8 }}>
                  {t(lang, "book_with_staff", { staff: withStaffLabel })}
                </p>
              )}
            </>
          )}
          {/* Shown only when EVERY chosen service carries a price — a
              partial sum would understate what the visit costs. */}
          {chosen.length > 0 && chosen.every((c) => c.price != null) && (
            <p className="hint" style={{ marginTop: 10, fontWeight: 700 }}>
              {t(lang, "book_total_price", {
                p: chosen.reduce((sum, c) => sum + Number(c.price), 0),
                currency: t(lang, "currency"),
              })}
            </p>
          )}
          {error && <p className="error-text">{t(lang, error)}</p>}
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => setStep("staff")}>
              {t(lang, "back")}
            </button>
            <button className="btn" disabled={!selectedSlot} onClick={() => setStep("contact")}>
              {t(lang, "next")}
            </button>
          </div>
        </div>
      )}

      {step === "contact" && (
        <form className="card wizard-step" onSubmit={handleSubmit}>
          <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "book_contact_step")}</p>

          {/* What is actually being booked. The reviewer pressed "confirm"
              on a screen that named neither the service, the day, the
              time, the specialist nor the price. */}
          <div className="book-summary">
            <div className="bs-row">
              <span className="bs-label">{t(lang, "book_summary_service")}</span>
              <span className="bs-value">{chosen.map((c) => c.name).join(" · ")}</span>
              <button type="button" className="bs-edit" onClick={() => setStep("service")}>
                {t(lang, "book_edit")}
              </button>
            </div>
            <div className="bs-row">
              <span className="bs-label">{t(lang, "book_summary_when")}</span>
              <span className="bs-value">
                {selectedSlot
                  ? `${new Intl.DateTimeFormat(intlLocale(lang), {
                      timeZone: timezone,
                      dateStyle: "full",
                    }).format(new Date(selectedSlot))} — ${fmtTime(selectedSlot)}`
                  : "—"}
              </span>
              <button type="button" className="bs-edit" onClick={() => setStep("slot")}>
                {t(lang, "book_edit")}
              </button>
            </div>
            <div className="bs-row">
              <span className="bs-label">{t(lang, "book_summary_staff")}</span>
              <span className="bs-value">{withStaffLabel ?? t(lang, "book_any_staff")}</span>
              <button type="button" className="bs-edit" onClick={() => setStep("staff")}>
                {t(lang, "book_edit")}
              </button>
            </div>
            {chosen.length > 0 && chosen.every((c) => c.price != null) && (
              <div className="bs-row bs-total">
                <span className="bs-label">{t(lang, "book_summary_total")}</span>
                {/* The row already says "Total"; repeating the whole
                    sentence read as "Total: Visit total: 25 JOD". */}
                <span className="bs-value">
                  {chosen.reduce((sum, c) => sum + Number(c.price), 0).toLocaleString(intlLocale(lang))}{" "}
                  {t(lang, "currency")}
                </span>
                <span />
              </div>
            )}
          </div>
          {/* Honeypot: invisible to real users, but bots that autofill every
              field on a form tend to fill this one too. Server-side rate
              limiting (0010_security_hardening.sql) is the real backstop;
              this just quietly short-circuits the common case.
              Hidden via .visually-hidden, NOT the old left:-9999px idiom —
              that assumes LTR, and in RTL the scrollable region grows the
              other way, so it added ~10,000px of real scrollable blankness.
              Measured on a 375px RTL viewport: scrollWidth 375 -> 10355 the
              moment this step rendered, and the phone parked itself at
              scrollLeft -1125 on its own, leaving the user on a blank
              screen. Desktop had the same overflow but stayed at scrollLeft
              0 unless you deliberately scrolled, which is why it only ever
              reproduced on a phone. */}
          <input
            type="text"
            name="website"
            className="visually-hidden"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
          <div className="field">
            <label htmlFor="name">{t(lang, "customer_name")}</label>
            <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="phone">{t(lang, "customer_phone")}</label>
            <input
              id="phone"
              dir="ltr"
              inputMode="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {/* Read the number back before they commit. A booking on a
                mistyped number is a slot the clinic loses and a customer
                it cannot warn — and the customer cannot undo it either.
                Only speaks once there is something to judge. */}
            {phone.trim() !== "" &&
              (isValidPhone(phone) ? (
                <p className="hint" style={{ marginTop: 6 }}>
                  {t(lang, "phone_confirm")}{" "}
                  <span dir="ltr" style={{ fontWeight: 700, color: "var(--brand)" }}>
                    {formatPhoneForDisplay(phone)}
                  </span>
                </p>
              ) : (
                <p className="error-text" style={{ marginTop: 6 }}>
                  {t(lang, "phone_invalid")}
                </p>
              ))}
          </div>
          <div className="field">
            <label htmlFor="email">{t(lang, "customer_email")}</label>
            <input id="email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="notes">{t(lang, "booking_notes")}</label>
            <textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <p className="error-text">{t(lang, error)}</p>}
          {conflictPending && (
            <button
              type="button"
              className="btn ghost"
              style={{ marginBottom: 10 }}
              disabled={pending}
              onClick={() => void submitBooking(true)}
            >
              {t(lang, "book_anyway")}
            </button>
          )}
          <div className="toolbar">
            <button type="button" className="btn ghost" onClick={() => setStep("slot")}>
              {t(lang, "back")}
            </button>
            <button type="submit" className="btn" disabled={pending || !isValidPhone(phone)}>
              {pending ? t(lang, "loading") : t(lang, "book_submit")}
            </button>
          </div>
        </form>
      )}

      {step === "done" && cancelToken && (
        <div className="card wizard-step" style={{ textAlign: "center" }}>
          <h2 style={{ color: "var(--brand)", marginBottom: 6 }}>{t(lang, "book_success_title")}</h2>
          <p className="hint" style={{ marginBottom: 16 }}>
            {t(lang, "book_success_sub")}
          </p>
          <div className="toolbar" style={{ justifyContent: "center", marginBottom: 12 }}>
            <Link href={`/${orgSlug}/booking/${cancelToken}`} className="btn">
              {t(lang, "book_manage_link")}
            </Link>
            {defaults && (
              <Link href="/my" className="btn ghost">
                {t(lang, "view_my_bookings")}
              </Link>
            )}
          </div>
          <ReminderOptIn lang={lang} cancelToken={cancelToken} />
        </div>
      )}

      {/* Defensive fallback: step "done" with no cancelToken previously
          rendered nothing at all (every other step's condition also
          false) — a genuinely blank page rather than an error message. */}
      {step === "done" && !cancelToken && (
        <div className="card wizard-step" style={{ textAlign: "center" }}>
          <p className="error-text">{t(lang, "error_generic")}</p>
          <Link href={`/${orgSlug}`} className="btn ghost" style={{ marginTop: 10 }}>
            {t(lang, "back")}
          </Link>
        </div>
      )}
    </div>
  );
}
