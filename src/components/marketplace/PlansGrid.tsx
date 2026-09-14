import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import {
  planName,
  formatJod,
  freeMonthsOnYearly,
  monthsLabel,
  upgradeWhatsappUrl,
  type Plan,
} from "@/lib/plan";

// The three plans, every number read from the plans table (0043).
//
// Honesty rules for a page that sells:
//  * SMS is listed with a "soon" marker — nothing sends SMS until OTP is
//    built, and a clinic must not sign up believing otherwise.
//  * No "most popular" badge. With no customers yet it would be invented.
//  * Payments are not wired, so every card starts the same free signup;
//    paid plans offer an upgrade request instead of a checkout.
export function PlansGrid({
  plans,
  lang,
  salesWhatsapp,
}: {
  plans: Plan[];
  lang: Lang;
  /** Sales WhatsApp number as digits, or null when not configured. */
  salesWhatsapp: string | null;
}) {
  const currency = t(lang, "currency");

  return (
    <div className="plans-grid">
      {plans.map((p) => {
        const free = p.priceMonthJod <= 0;
        const months = freeMonthsOnYearly(p);
        const staff =
          p.maxStaff == null
            ? t(lang, "plan_feat_staff_unlimited")
            : p.maxStaff === 1
              ? t(lang, "plan_feat_staff_one")
              : t(lang, "plan_feat_staff_upto", { n: p.maxStaff });

        return (
          <div key={p.id} className={`plan-card${p.id === "basic" ? " mid" : ""}`}>
            <p className="plan-name">{planName(p.id, lang)}</p>
            <div className="plan-price">
              <strong>{free ? t(lang, "plan_free_price") : formatJod(p.priceMonthJod)}</strong>
              {!free && (
                <span>
                  {currency} / {t(lang, "plan_per_month")}
                </span>
              )}
            </div>
            <p className="plan-yearly">
              {months
                ? t(lang, "plan_yearly_note", {
                    price: formatJod(p.priceYearJod),
                    currency,
                    months: monthsLabel(months, lang),
                  })
                : ""}
            </p>
            <ul className="plan-feats">
              <li>{staff}</li>
              <li>{t(lang, "plan_feat_unlimited")}</li>
              <li>{t(lang, "plan_feat_no_commission")}</li>
              <li>{t(lang, "plan_feat_reminders")}</li>
              {p.smsPerMonth > 0 ? (
                <li>
                  {t(lang, "plan_feat_sms", { n: p.smsPerMonth })}
                  <span className="plan-soon">{t(lang, "plan_soon")}</span>
                </li>
              ) : (
                <li className="off">{t(lang, "plan_feat_no_sms")}</li>
              )}
              {p.featured && <li>{t(lang, "plan_feat_featured")}</li>}
            </ul>
            <Link href="/signup" className={`btn block${p.id === "basic" ? "" : " ghost"}`}>
              {t(lang, "plan_cta")}
            </Link>
            {!free && salesWhatsapp && (
              <p className="plan-upgrade">
                <a
                  href={upgradeWhatsappUrl(salesWhatsapp, planName(p.id, lang), lang)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t(lang, "plan_upgrade_whatsapp")}
                </a>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
