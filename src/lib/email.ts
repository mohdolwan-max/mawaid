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
  const subject = isAr ? `تأكيد حجزك في ${input.orgName}` : `Your booking at ${input.orgName} is confirmed`;
  const services =
    input.services.length === 1
      ? `<p><strong>${input.orgName}</strong> — ${input.services[0].name}</p>
      <p>${when}</p>`
      : `<p><strong>${input.orgName}</strong></p>
      <p>${when}</p>
      <ul style="padding-inline-start:18px;margin:8px 0;">
        ${input.services
          .map((s) => `<li>${s.name} — ${timeOf(s.startAt)}</li>`)
          .join("\n        ")}
      </ul>`;

  const html = `
    <div dir="${isAr ? "rtl" : "ltr"}" style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#146c63;">${isAr ? "تم تأكيد حجزك ✓" : "Booking confirmed ✓"}</h2>
      <p>${isAr ? `مرحباً ${input.toName}،` : `Hi ${input.toName},`}</p>
      ${services}
      <p><a href="${input.manageUrl}">${isAr ? "إدارة الحجز" : "Manage booking"}</a></p>
    </div>
  `;

  try {
    await resend.emails.send({
      from: process.env.BOOKING_EMAIL_FROM ?? "bookings@mawaid.app",
      to: input.toEmail,
      subject,
      html,
    });
  } catch (err) {
    console.error("Failed to send booking confirmation email", err);
  }
}
