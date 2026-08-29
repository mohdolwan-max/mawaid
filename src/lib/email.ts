import "server-only";
import { Resend } from "resend";

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
  serviceName: string;
  startAt: string;
  timezone: string;
  lang: "ar" | "en";
  manageUrl: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — skipping booking confirmation email");
    return;
  }

  const resend = new Resend(apiKey);
  const when = new Date(input.startAt).toLocaleString(input.lang === "ar" ? "ar-SA" : "en-US", {
    timeZone: input.timezone,
    dateStyle: "full",
    timeStyle: "short",
  });

  const isAr = input.lang === "ar";
  const subject = isAr ? `تأكيد حجزك في ${input.orgName}` : `Your booking at ${input.orgName} is confirmed`;
  const html = `
    <div dir="${isAr ? "rtl" : "ltr"}" style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#146c63;">${isAr ? "تم تأكيد حجزك ✓" : "Booking confirmed ✓"}</h2>
      <p>${isAr ? `مرحباً ${input.toName}،` : `Hi ${input.toName},`}</p>
      <p><strong>${input.orgName}</strong> — ${input.serviceName}</p>
      <p>${when}</p>
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
