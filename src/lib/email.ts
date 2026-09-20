import "server-only";
import { Resend } from "resend";
import { intlLocale } from "@/lib/date";

// Booking confirmation is sent from the Server Action after
// book_appointment() succeeds (src/app/[orgSlug]/book/actions.ts) — never
// from inside the SQL function itself, so a slow/broken email provider can
// never make the booking transaction itself fail or roll back.
//
// Gracefully no-ops without RESEND_API_KEY (e.g. local dev before a Resend
// account is wired up) — logs instead of throwing, since a missing email
// confirmation should never break the booking flow itself.

// The booking form is public, and both the customer name and the
// recipient address come straight from it. Interpolated raw, that let
// anyone send an HTML link of their choosing from bookings@maw3ed.me to
// an address of their choosing: a phishing mail carrying this domain DMARC
// pass. External audit, 2026-09-20. Length is capped too, so the greeting
// line cannot be used as a message board (customer_name has no DB limit).
function esc(value: string, max = 120): string {
  return value
    .slice(0, max)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Subject lines are plain text, not HTML: cut, and no line breaks that
// could reach the mail headers.
function oneLine(value: string, max = 120): string {
  return value.slice(0, max).replace(/[\r\n]+/g, " ").trim();
}

export async function sendBookingConfirmation(input: {
  toEmail: string;
  toName: string;
  orgName: string;
  /** Every service in the visit, in the order they happen. A one-service
   *  booking passes a single entry. Previously this was one name and one
   *  time, so a three-service visit produced an email describing a
   *  30-minute appointment. */
  services: { name: string; startAt: string }[];
  timezone: string;
  lang: "ar" | "en";
  manageUrl: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — skipping booking confirmation email");
    return;
  }
  if (input.services.length === 0) {
    console.error("sendBookingConfirmation called with no services — not sending");
    return;
  }

  const resend = new Resend(apiKey);
  const locale = intlLocale(input.lang);
  const when = new Date(input.services[0].startAt).toLocaleString(locale, {
    timeZone: input.timezone,
    dateStyle: "full",
    timeStyle: "short",
  });
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, {
      timeZone: input.timezone,
      hour: "numeric",
      minute: "2-digit",
    });

  const isAr = input.lang === "ar";
  const subject = isAr ? `تأكيد حجزك في ${oneLine(input.orgName)}` : `Your booking at ${oneLine(input.orgName)} is confirmed`;
  const services =
    input.services.length === 1
      ? `<p><strong>${esc(input.orgName)}</strong> — ${esc(input.services[0].name)}</p>
      <p>${when}</p>`
      : `<p><strong>${esc(input.orgName)}</strong></p>
      <p>${when}</p>
      <ul style="padding-inline-start:18px;margin:8px 0;">
        ${input.services
          .map((s) => `<li>${esc(s.name)} — ${timeOf(s.startAt)}</li>`)
          .join("\n        ")}
      </ul>`;

  const html = `
    <div dir="${isAr ? "rtl" : "ltr"}" style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#146c63;">${isAr ? "تم تأكيد حجزك ✓" : "Booking confirmed ✓"}</h2>
      <p>${isAr ? `مرحباً ${esc(input.toName, 80)}،` : `Hi ${esc(input.toName, 80)},`}</p>
      ${services}
      <p><a href="${esc(input.manageUrl, 300)}">${isAr ? "إدارة الحجز" : "Manage booking"}</a></p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: process.env.BOOKING_EMAIL_FROM ?? "bookings@maw3ed.me",
      to: input.toEmail,
      subject,
      html,
    });
  } catch (err) {
    console.error("Failed to send booking confirmation email", err);
  }
}
