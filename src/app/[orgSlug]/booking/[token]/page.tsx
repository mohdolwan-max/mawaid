import { notFound } from "next/navigation";
import { getLang } from "@/lib/lang";
import { t, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { getBookingVisitByToken } from "@/lib/availability";
import { getPublicOrg } from "@/lib/publicOrg";
import { canReview } from "@/lib/reviews";
import { CancelButton } from "./CancelButton";
import { RescheduleCard } from "./RescheduleCard";
import { ReviewForm } from "./ReviewForm";
import { ReminderOptIn } from "@/components/marketplace/ReminderOptIn";
import { BackBar } from "@/components/marketplace/BackBar";

export default async function BookingStatusPage({
  params,
}: {
  params: Promise<{ orgSlug: string; token: string }>;
}) {
  const { orgSlug, token } = await params;
  const lang = await getLang();

  // One row for an ordinary booking, several for a multi-service visit —
  // all of them reachable from this single link, because a guest has no
  // account and therefore no bookings list to find the rest in.
  const segments = await getBookingVisitByToken(token);
  if (segments.length === 0) notFound();

  const first = segments[0];
  // Times must be shown in the CLINIC's timezone, not the visitor's —
  // a customer abroad picking "5pm" must get the clinic's 5pm.
  const org = await getPublicOrg(first.org_slug);
  const timezone = org?.timezone ?? "Asia/Amman";
  const last = segments[segments.length - 1];
  const status = first.status;
  const reviewable = status === "completed" ? await canReview(token) : false;

  const start = new Date(first.start_at);
  const locale = intlLocale(lang);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <div className="public-shell">
      <BackBar href={`/${orgSlug}`} title="" />
      <div className="card">
        <h1 style={{ color: "var(--brand)", marginBottom: 6 }}>{first.org_name}</h1>

        <p className="hint" style={{ marginBottom: 10 }}>
          {start.toLocaleDateString(locale, { timeZone: timezone, dateStyle: "full" })}
          {" — "}
          {time(first.start_at)}
          {segments.length > 1 && ` ${t(lang, "booking_until")} ${time(last.end_at)}`}
        </p>

        {segments.length === 1 ? (
          <p>
            <strong>{first.service_name}</strong>
          </p>
        ) : (
          // Every service is listed with its own time, so the customer can
          // see the whole visit rather than just the piece their link
          // happened to point at.
          <ul className="visit-list">
            {segments.map((s) => (
              <li key={s.id}>
                <strong>{s.service_name}</strong>
                <span dir="ltr">
                  {time(s.start_at)} – {time(s.end_at)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p style={{ margin: "10px 0" }}>
          <span
            className={`chip ${status === "booked" ? "good" : status === "cancelled" ? "bad" : "neutral"}`}
          >
            {t(lang, `booking_status_${status}` as TKey)}
          </span>
        </p>

        {status === "booked" && (
          <>
            {segments.length > 1 && (
              <p className="hint" style={{ marginBottom: 8 }}>
                {t(lang, "booking_cancel_whole_visit", { n: segments.length.toLocaleString(locale) })}
                {" "}
                {t(lang, "resched_visit_note")}
              </p>
            )}
            <RescheduleCard
              lang={lang}
              token={token}
              orgSlug={first.org_slug}
              serviceId={first.service_id}
              staffId={first.staff_id}
              timezone={timezone}
            />
            <div className="toolbar" style={{ marginTop: 10 }}>
              <CancelButton lang={lang} token={token} />
              <ReminderOptIn lang={lang} cancelToken={token} />
            </div>
          </>
        )}
      </div>

      {reviewable && (
        <div className="card">
          <ReviewForm lang={lang} token={token} />
        </div>
      )}
    </div>
  );
}
