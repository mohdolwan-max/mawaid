"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t, type Lang, type TKey } from "@/lib/i18n";
import { intlLocale } from "@/lib/date";
import { getPaymentStatus, type PaymentStatusView } from "../actions";

const POLL_MS = 2000;
const GIVE_UP_MS = 45_000;

// The gateway sends the browser back as soon as the card step ends, but
// the payment is only marked paid when its verified webhook arrives,
// usually seconds later. So this polls the database rather than
// believing anything in the return URL, and says so plainly if the
// confirmation is slow instead of claiming success or failure.
export function PaymentReturn({ lang, paymentId, timezone }: { lang: Lang; paymentId: string; timezone: string }) {
  const [payment, setPayment] = useState<PaymentStatusView | null>(null);
  const [missing, setMissing] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<TKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();

    async function tick() {
      const res = await getPaymentStatus(paymentId).catch(() => ({ error: "error_generic" as const }));
      if (cancelled) return;
      if ("error" in res) {
        setError(res.error);
      } else if (!res.payment) {
        setMissing(true);
        return;
      } else {
        setError(null);
        setPayment(res.payment);
        if (res.payment.status !== "pending") return;
      }
      if (Date.now() - started > GIVE_UP_MS) {
        setSlow(true);
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [paymentId]);

  let message: string;
  let className = "";
  if (missing) {
    message = t(lang, "billing_return_unknown");
  } else if (!payment || payment.status === "pending") {
    message = t(lang, slow ? "billing_return_slow" : "billing_return_pending");
  } else if (payment.status === "paid") {
    message =
      payment.kind === "plan" && payment.planEndsAt
        ? t(lang, "billing_return_paid_plan", {
            date: new Intl.DateTimeFormat(intlLocale(lang), { timeZone: timezone, dateStyle: "long" }).format(
              new Date(payment.planEndsAt)
            ),
          })
        : t(lang, "billing_return_paid_offer");
  } else if (payment.status === "refunded") {
    message = t(lang, "billing_return_refunded");
  } else if (payment.status === "needs_refund") {
    message = t(lang, "billing_return_refund");
    className = "error-text";
  } else {
    message = t(lang, "billing_return_failed");
    className = "error-text";
  }

  return (
    <div className="card billing-return" role="status" aria-live="polite">
      <p className={className}>{message}</p>
      {error && <p className="error-text">{t(lang, error)}</p>}
      <Link href={payment?.kind === "offer" ? "/offers" : "/billing"} className="btn">
        {t(lang, payment?.kind === "offer" ? "nav_offers" : "billing_back")}
      </Link>
    </div>
  );
}
