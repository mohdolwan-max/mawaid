import { notFound } from "next/navigation";
import { getLang } from "@/lib/lang";
import { t, type TKey } from "@/lib/i18n";
import { getBookingByToken } from "@/lib/availability";
import { canReview } from "@/lib/reviews";
import { CancelButton } from "./CancelButton";
import { ReviewForm } from "./ReviewForm";

export default async function BookingStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lang = await getLang();

  const booking = await getBookingByToken(token);
  if (!booking) notFound();

  const reviewable = booking.status === "completed" ? await canReview(token) : false;
  const start = new Date(booking.start_at);

  return (
    <div className="public-shell">
      <div className="card">
        <h1 style={{ color: "var(--brand)", marginBottom: 6 }}>{booking.org_name}</h1>
        <p>
          <strong>{booking.service_name}</strong>
        </p>
        <p className="hint">
          {start.toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { dateStyle: "full" })}
          {" — "}
          {start.toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-US", { hour: "numeric", minute: "2-digit" })}
        </p>
        <p style={{ margin: "10px 0" }}>
          <span
            className={`chip ${
              booking.status === "booked" ? "good" : booking.status === "cancelled" ? "bad" : "neutral"
            }`}
          >
            {t(lang, `booking_status_${booking.status}` as TKey)}
          </span>
        </p>
        {booking.status === "booked" && <CancelButton lang={lang} token={token} />}
      </div>

      {reviewable && (
        <div className="card">
          <ReviewForm lang={lang} token={token} />
        </div>
      )}
    </div>
  );
}
