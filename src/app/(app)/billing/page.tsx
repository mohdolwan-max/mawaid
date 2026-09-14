import { requireOrgContext } from "@/lib/org";
import { t } from "@/lib/i18n";
import { getMyPlanUsage } from "@/lib/planServer";
import { getMyMandate, getPurchaseOptions, listMyPayments } from "@/lib/billingServer";
import { paymentsReady } from "@/lib/payments";
import { PlanCard } from "../dashboard/PlanCard";
import { BillingClient } from "./BillingClient";

export default async function BillingPage() {
  const ctx = await requireOrgContext();
  const lang = ctx.lang;

  const head = (
    <div className="page-head">
      <div>
        <h2>{t(lang, "billing_title")}</h2>
        <p>{t(lang, "billing_sub")}</p>
      </div>
    </div>
  );

  // Paying is the owner's decision, like the plan itself (0043).
  if (ctx.role !== "owner") {
    return (
      <div>
        {head}
        <div className="empty">{t(lang, "billing_owner_only")}</div>
      </div>
    );
  }

  const [usage, options, payments, mandateRes] = await Promise.all([
    getMyPlanUsage(),
    getPurchaseOptions(),
    listMyPayments(),
    getMyMandate(),
  ]);

  // Without the prices and dates there is nothing honest to offer.
  if (!options || options.length === 0) {
    return (
      <div>
        {head}
        <div className="empty">{t(lang, "billing_load_failed")}</div>
      </div>
    );
  }

  return (
    <div>
      {head}
      {usage && <PlanCard usage={usage} lang={lang} showAction={false} />}
      <BillingClient
        lang={lang}
        timezone={ctx.timezone}
        nowIso={new Date().toISOString()}
        currentPlan={usage?.planId ?? null}
        options={options}
        payments={payments}
        mandate={mandateRes?.mandate ?? null}
        mandateLoaded={mandateRes !== null}
        paymentReady={paymentsReady()}
      />
    </div>
  );
}
