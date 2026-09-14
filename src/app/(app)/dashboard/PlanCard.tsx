import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { daysLabel, daysLeft, planName, upgradeWhatsappUrl, type PlanUsage } from "@/lib/plan";

// The owner's plan: what it is, when it ends, and how much of it is used.
// Seats include pending invitations, because that is how the limit counts
// (0043) — showing "3 of 5" while the database already counts 5 would
// make the refusal on the next invite look like a bug.
//
// There is no free plan to fall back to (0046). A trial or plan that ends
// has grace days, then the clinic closes to the public, so this card says
// in days which of those the clinic is in and offers the step that fixes it.
export function PlanCard({
  usage,
  lang,
  salesWhatsapp,
}: {
  usage: PlanUsage;
  lang: Lang;
  salesWhatsapp: string | null;
}) {
  const limited = usage.maxStaff != null;
  const full = limited && usage.seatsUsed >= (usage.maxStaff as number);
  const over = limited && usage.seatsUsed > (usage.maxStaff as number);
  const pct = limited ? Math.min(100, Math.round((usage.seatsUsed / (usage.maxStaff as number)) * 100)) : null;

  const now = Date.now();
  const endsIn = daysLeft(usage.expiresAt, now);
  const graceLeft = daysLeft(usage.openUntil, now);

  // During a trial or after a plan ends, the step is paying for the plan
  // the clinic is on; otherwise it is the next tier up.
  const mustPay = usage.isTrial || usage.phase !== "active";
  const offerPlan = mustPay ? usage.planId : usage.planId === "basic" ? "pro" : null;

  let status: { text: string; className: string } | null = null;
  if (usage.phase === "lapsed") {
    status = { text: t(lang, "plan_lapsed"), className: "error-text" };
  } else if (usage.phase === "grace") {
    status = {
      text: t(lang, usage.isTrial ? "plan_grace_trial" : "plan_grace_paid", {
        days: graceLeft === null ? "" : daysLabel(graceLeft, lang),
      }),
      className: "error-text",
    };
  } else if (endsIn !== null) {
    status = {
      text: t(lang, usage.isTrial ? "plan_trial_left" : "plan_ends_in", { days: daysLabel(endsIn, lang) }),
      className: "hint",
    };
  }

  return (
    <div className="card plan-usage-card">
      <div className="pu-body">
        <label>{t(lang, "plan_card_title")}</label>
        <div className="pu-name">
          {planName(usage.planId, lang)}
          {usage.isTrial && <span className="pu-trial">{t(lang, "plan_trial_badge")}</span>}
        </div>
        {status && (
          <p className={status.className} style={{ margin: "4px 0 0" }}>
            {status.text}
          </p>
        )}
        <p className="hint" style={{ margin: "4px 0 0" }}>
          {limited
            ? t(lang, "plan_seats", { used: usage.seatsUsed, max: usage.maxStaff as number })
            : t(lang, "plan_seats_unlimited", { used: usage.seatsUsed })}
        </p>
        {pct != null && (
          <div className={`pu-bar${full ? " full" : ""}`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        <p className="hint" style={{ margin: 0 }}>
          {t(lang, "plan_seats_hint")}
        </p>
        {over && (
          <p className="error-text" style={{ margin: "6px 0 0" }}>
            {t(lang, "plan_over_limit")}
          </p>
        )}
      </div>
      {offerPlan && (
        <div className="toolbar" style={{ flexShrink: 0 }}>
          <Link href="/partners#plans" className="btn ghost sm">
            {t(lang, "plan_see_plans")}
          </Link>
          {salesWhatsapp && (
            <a
              className="btn sm"
              href={upgradeWhatsappUrl(
                salesWhatsapp,
                planName(offerPlan, lang),
                lang,
                mustPay ? "subscribe" : "upgrade"
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t(lang, mustPay ? "plan_subscribe_whatsapp" : "plan_upgrade_whatsapp")}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
