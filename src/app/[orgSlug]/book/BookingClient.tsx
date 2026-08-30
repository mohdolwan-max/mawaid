"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t, type Lang, type TKey } from "@/lib/i18n";
import type { PublicService, PublicStaff } from "@/lib/publicOrg";
import { ReminderOptIn } from "@/components/marketplace/ReminderOptIn";
import { fetchStaffAction, fetchSlotsAction, submitBookingAction } from "./actions";

type Step = "service" | "staff" | "slot" | "contact" | "done";

const STEP_ORDER: Step[] = ["service", "staff", "slot", "contact"];
const STEP_LABELS: TKey[] = ["step_service", "step_staff", "step_time", "step_info"];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
}: {
  lang: Lang;
  orgSlug: string;
  services: PublicService[];
  defaults: { name: string; phone: string; email: string } | null;
}) {
  const [step, setStep] = useState<Step>("service");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

  const [service, setService] = useState<PublicService | null>(null);
  const [staffOptions, setStaffOptions] = useState<PublicStaff[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);

  const [date, setDate] = useState(todayISO());
  const [slots, setSlots] = useState<string[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [name, setName] = useState(defaults?.name ?? "");
  const [phone, setPhone] = useState(defaults?.phone ?? "");
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [notes, setNotes] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const [cancelToken, setCancelToken] = useState<string | null>(null);

  function chooseService(s: PublicService) {
    setService(s);
    setStaffId(null);
    setError(null);
    // A rejected promise here previously had no .catch() — a transient
    // network blip left staffOptions stuck at [] silently (degraded but
    // visible: just "any available staff"). Surfacing the error is
    // better than pretending the org genuinely has no staff to pick.
    fetchStaffAction(orgSlug, s.id)
      .then(setStaffOptions)
      .catch(() => setError("error_generic"));
    setStep("staff");
  }

  useEffect(() => {
    if (step !== "slot" || !service) return;
    let cancelled = false;
    setSlotsLoading(true);
    setSelectedSlot(null);
    setError(null);
    fetchSlotsAction(orgSlug, service.id, date, staffId)
      .then((s) => {
        if (cancelled) return;
        setSlots(s);
        setSlotsLoading(false);
      })
      .catch(() => {
        // Previously unhandled: a rejected fetch here left slotsLoading
        // stuck true forever — the date picker stayed, but the slot
        // grid never resolved either way, reading as a dead/blank step.
        if (cancelled) return;
        setSlots([]);
        setSlotsLoading(false);
        setError("error_generic");
      });
    return () => {
      cancelled = true;
    };
  }, [step, service, date, staffId, orgSlug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!service || !selectedSlot) return;
    if (honeypot.trim() !== "") {
      // Silently pretend it worked — don't tip off the bot.
      setCancelToken("00000000-0000-0000-0000-000000000000");
      setStep("done");
      return;
    }
    setPending(true);
    setError(null);
    const result = await submitBookingAction({
      orgSlug,
      serviceId: service.id,
      startAt: selectedSlot,
      staffId,
      customerName: name,
      customerPhone: phone,
      customerEmail: email,
      notes,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error as TKey);
      if (result.error === "book_slot_taken") {
        setStep("slot");
      }
      return;
    }
    setCancelToken(result.cancelToken);
    setStep("done");
  }

  return (
    <div>
      <StepsBar lang={lang} step={step} />

      {step === "service" && (
        <div className="card wizard-step">
          <p style={{ fontWeight: 700, marginBottom: 10 }}>{t(lang, "book_service_step")}</p>
          {services.map((s) => (
            <div key={s.id} className="service-row" onClick={() => chooseService(s)}>
              <div>
                <strong>{s.name}</strong>
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
          ))}
          <div className="toolbar" style={{ marginTop: 10 }}>
            <Link href={`/${orgSlug}`} className="btn ghost">
              {t(lang, "back")}
            </Link>
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
              {st.email}
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
            <input type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
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
                  className={`slot-btn ${selectedSlot === slotIso ? "selected" : ""}`}
                  onClick={() => setSelectedSlot(slotIso)}
                >
                  {new Date(slotIso).toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </button>
              ))}
            </div>
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
          {/* Honeypot: invisible to real users, but bots that autofill every
              field on a form tend to fill this one too. Server-side rate
              limiting (0010_security_hardening.sql) is the real backstop;
              this just quietly short-circuits the common case. */}
          <input
            type="text"
            name="website"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
          />
          <div className="field">
            <label htmlFor="name">{t(lang, "customer_name")}</label>
            <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="phone">{t(lang, "customer_phone")}</label>
            <input id="phone" dir="ltr" required value={phone} onChange={(e) => setPhone(e.target.value)} />
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
          <div className="toolbar">
            <button type="button" className="btn ghost" onClick={() => setStep("slot")}>
              {t(lang, "back")}
            </button>
            <button type="submit" className="btn" disabled={pending}>
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
