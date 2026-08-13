import Link from "next/link";
import { redirect } from "next/navigation";
import { getLang } from "@/lib/lang";
import { getCity } from "@/lib/city";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { getCustomerProfile, listMyBookings, type MyBooking } from "@/lib/customer";
import { PublicNav } from "@/components/marketplace/PublicNav";
import { BottomNav } from "@/components/marketplace/BottomNav";
import { CancelMyBooking } from "./CancelMyBooking";

export default async function MyBookingsPage() {
  const [lang, city] = await Promise.all([getLang(), getCity()]);

  const profile = await getCustomerProfile();
  if (!profile) {
    // Signed out (middleware normally catches this) or an org account.
    redirect("/account?next=/my");
  }

  const bookings = await listMyBookings();
  const now = Date.now();
  const upcoming = bookings.filter((b) => new Date(b.start_at).getTime() >= now && b.status === "booked");
  const past = bookings.filter((b) => new Date(b.start_at).getTime() < now || b.status !== "booked");

  return (
    <div className="market-shell">
      <PublicNav lang={lang} city={city} />

      <div className="page-head">
        <h2 style={{ color: "var(--brand)", fontSize: 21, fontWeight: 800 }}>
          {t(lang, "my_bookings_title")}
        </h2>
      </div>

      {bookings.length === 0 ? (
        <div className="card" style={{ textAlign: "center" }}>
          <p style={{ marginBottom: 12 }}>{t(lang, "my_empty")}</p>
          <Link href="/search" className="btn">
            {t(lang, "my_browse_cta")}
          </Link>
        </div>
      ) : (
        <>
          <BookingGroup title={t(lang, "my_upcoming")} rows={upcoming} lang={lang} showCancel />
          <BookingGroup title={t(lang, "my_past")} rows={past} lang={lang} showCancel={false} />
        </>
      )}

      <BottomNav lang={lang} />
    </div>
  );
}

function BookingGroup({
  title,
  rows,
  lang,
  showCancel,
}: {
  title: string;
  rows: MyBooking[];
  lang: Lang;
  showCancel: boolean;
}) {
  if (rows.length === 0) return null;

  return (
    <div className="card">
      <p style={{ fontWeight: 700, marginBottom: 10 }}>{title}</p>
      {rows.map((b) => (
        <div key={b.id} className="service-row" style={{ cursor: "default" }}>
          <div>
            <strong>{b.org_name}</strong>
            <p className="hint">{b.service_name}</p>
            <p className="hint" dir="ltr">
              {new Date(b.start_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <span
              className={`chip ${
                b.status === "booked" ? "good" : b.status === "cancelled" ? "bad" : "neutral"
              }`}
            >
              {t(lang, `booking_status_${b.status}` as TKey)}
            </span>
            <div className="toolbar">
              <Link href={`/${b.org_slug}/booking/${b.cancel_token}`} className="btn ghost sm">
                {t(lang, "booking_details")}
              </Link>
              {b.status === "completed" && !b.has_review && (
                <Link href={`/${b.org_slug}/booking/${b.cancel_token}`} className="btn sm">
                  {t(lang, "review_cta")}
                </Link>
              )}
              {showCancel && b.status === "booked" && <CancelMyBooking lang={lang} token={b.cancel_token} />}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
