import "server-only";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { intlLocale } from "@/lib/date";
import { canonicalSiteUrl } from "@/lib/siteUrl";
import { waitlistBookHref } from "@/lib/waitlist";

// Emails the customers whose waited-for day just had a time given up
// (0066). The database decides who is due and stamps them in the same
// step, so two runs never email one person twice; this only sends.
//
// Called right after anything that can give a time up (a customer's
// cancel or move, the clinic's cancel or move), and from the five-minute
// cron as the net under all of them. Never throws: a failed email must
// not turn a cancellation into an error.

type Due = {
  id: string;
  email: string;
  customer_name: string;
  lang: "ar" | "en";
  day: string;
  service_ids: string[];
  org_name: string;
  org_slug: string;
  timezone: string;
};

function esc(value: string, max = 120): string {
  return value
    .slice(0, max)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const oneLine = (value: string, max = 120) => value.slice(0, max).replace(/[\r\n]+/g, " ").trim();

export async function sendWaitlistNotices(): Promise<number> {
  const secret = process.env.BOOKING_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  if (!secret || !apiKey) return 0;
  try {
    // No user session: the claim is gated by the booking secret.
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.rpc("claim_waitlist_notices", { p_secret: secret });
    if (error) {
      // PGRST202: 0066 not applied yet. Nothing waits, nothing to say.
      if (error.code !== "PGRST202") console.error("claim_waitlist_notices failed", error);
      return 0;
    }
    const due = (data as Due[] | null) ?? [];
    if (due.length === 0) return 0;

    const resend = new Resend(apiKey);
    const site = canonicalSiteUrl();
    let sent = 0;
    for (const d of due) {
      const isAr = d.lang !== "en";
      const day = String(d.day).slice(0, 10);
      const dayLabel = new Intl.DateTimeFormat(intlLocale(isAr ? "ar" : "en"), {
        dateStyle: "full",
        timeZone: "UTC",
      }).format(new Date(`${day}T12:00:00Z`));
      const link = site + waitlistBookHref(d.org_slug, d.service_ids, day);
      const subject = isAr
        ? `قد يكون توفر موعد في ${oneLine(d.org_name)}`
        : `A time may have opened at ${oneLine(d.org_name)}`;
      const html = `
        <div dir="${isAr ? "rtl" : "ltr"}" style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <p>${isAr ? `مرحباً ${esc(d.customer_name, 80)}،` : `Hi ${esc(d.customer_name, 80)},`}</p>
          <p>${
            isAr
              ? `أُلغي موعد في <strong>${esc(d.org_name)}</strong> يوم ${esc(dayLabel)}، وهو اليوم الذي طلبته. يحجزه أول من يصل إليه.`
              : `A booking at <strong>${esc(d.org_name)}</strong> on ${esc(dayLabel)}, the day you asked for, was given up. The first to book it has it.`
          }</p>
          <p><a href="${esc(link, 400)}" style="display:inline-block;background:#146c63;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;">${
            isAr ? "عرض الأوقات المتاحة" : "See the free times"
          }</a></p>
          <p style="color:#666;font-size:13px;">${
            isAr
              ? "وصلتك هذه الرسالة لأنك انضممت إلى قائمة الانتظار. لا ترد عليها؛ تواصل مع العيادة مباشرة."
              : "You are receiving this because you joined the waitlist. Please contact the clinic directly rather than replying."
          }</p>
        </div>`;
      try {
        await resend.emails.send({
          from: process.env.BOOKING_EMAIL_FROM ?? "bookings@maw3ed.me",
          to: d.email,
          subject,
          html,
        });
        sent++;
      } catch (err) {
        console.error("waitlist email failed", err);
      }
    }
    return sent;
  } catch (e) {
    console.error("sendWaitlistNotices threw", e);
    return 0;
  }
}
