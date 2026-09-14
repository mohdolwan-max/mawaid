import Link from "next/link";
import { t, type Lang } from "@/lib/i18n";
import { daysLabel, daysLeft, type PlanUsage } from "@/lib/plan";

// On every dashboard page once a plan has ended (0046), for everyone in
// the clinic: staff are the ones answering when a customer calls to say
// the booking page is gone. Only the owner is pointed at subscribing.
export function PlanNotice({ usage, lang, isOwner }: { usage: PlanUsage; lang: Lang; isOwner: boolean }) {
  if (usage.phase === "active") return null;

  const graceLeft = daysLeft(usage.openUntil, Date.now());
  const text =
    usage.phase === "grace"
      ? t(lang, usage.isTrial ? "plan_grace_trial" : "plan_grace_paid", {
          days: graceLeft === null ? "" : daysLabel(graceLeft, lang),
        })
      : t(lang, "plan_lapsed");

  return (
    <div className={`plan-notice ${usage.phase}`} role="status">
      <span>{text}</span>
      {isOwner && <Link href="/dashboard">{t(lang, "plan_notice_cta")}</Link>}
    </div>
  );
}
