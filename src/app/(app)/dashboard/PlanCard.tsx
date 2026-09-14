import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { planName, upgradeWhatsappUrl, type PlanUsage } from "@/lib/plan";

// The owner's plan and how much of it is used. Seats include pending
// invitations, because that is how the limit counts (0043) — showing
// "3 of 5" while the database already counts 5 would make the refusal on
// the next invite look like a bug.
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
  // The next tier up is what an upgrade button offers.
  const nextPlan = usage.planId === "free" ? "basic" : usage.planId === "basic" ? "pro" : null;

  return (
    <div className="card plan-usage-card">
      <div className="pu-body">
        <label>{t(lang, "plan_card_title")}</label>
        <div className="pu-name">{planName(usage.planId, lang)}</div>
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
        {usage.expired && (
          <p className="error-text" style={{ margin: "6px 0 0" }}>
            {t(lang, "plan_expired", { name: planName(usage.storedPlanId, lang) })}
          </p>
        )}
        {over && (
          <p className="error-text" style={{ margin: "6px 0 0" }}>
            {t(lang, "plan_over_limit")}
          </p>
        )}
      </div>
      {nextPlan && (
        <div className="toolbar" style={{ flexShrink: 0 }}>
          <Link href="/partners#plans" className="btn ghost sm">
            {t(lang, "plan_see_plans")}
          </Link>
          {salesWhatsapp && (
            <a
              className="btn sm"
              href={upgradeWhatsappUrl(salesWhatsapp, planName(nextPlan, lang), lang)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t(lang, "plan_upgrade_whatsapp")}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
