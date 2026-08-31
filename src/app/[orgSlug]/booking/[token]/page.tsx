import { notFound } from "next/navigation";
import { getLang } from "@/lib/lang";
import { t, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { getBookingVisitByToken } from "@/lib/availability";
import { canReview } from "@/lib/reviews";
import { CancelButton } from "./CancelButton";
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
  const last = segments[segments.length - 1];
  const status = first.status;
  const reviewable = status === "completed" ? await canReview(token) : false;

  const start = new Date(first.start_at);
  const locale = intlLocale(lang);
  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

  return (
    <div className="public-shell">
      <BackBar href={`/${orgSlug}`} title="" />
      <div className="card">
        <h1 style={{ color: "var(--brand)", marginBottom: 6 }}>{first.org_name}</h1>

        <p className="hint" style={{ marginBottom: 10 }}>
          {start.toLocaleDateString(locale, { dateStyle: "full" })}
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
                {t(lang, "booking_cancel_whole_visit", { n: String(segments.length) })}
              </p>
            )}
            <div className="toolbar">
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
