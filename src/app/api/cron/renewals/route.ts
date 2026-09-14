import { NextResponse, type NextRequest } from "next/server";
import { getPaymentProvider, paymentsDb, paymentsSecret } from "@/lib/payments";
import { formatAmount } from "@/lib/billing";

// Automatic renewal: charges the saved card of every plan ending within a
// day (claim_due_renewals, 0047/0048), then confirms or fails each payment.
// Gated by CRON_SECRET like the other cron routes; the database calls are
// gated separately by PAYMENTS_SECRET.
//
// Not scheduled yet: the pg_cron job is added once the gateway has
// recurring charges switched on for the live profile, so nothing is
// claimed before a card can actually be charged.

type DueRow = {
  payment_id: string;
  org_id: string;
  provider: string;
  provider_mandate_ref: string;
  plan_id: string;
  period: string;
  amount: number | string;
  currency: string;
};

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const provider = getPaymentProvider();
  const secret = paymentsSecret();
  if (!provider || !secret) {
    // Nothing is claimed, so nothing is left half-charged.
    return NextResponse.json({ skipped: "payments_not_configured" });
  }

  const db = paymentsDb();
  const { data, error } = await db.rpc("claim_due_renewals", { p_secret: secret });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as DueRow[] | null) ?? [];
  // The origin the job was called on (pg_cron targets www, 0038), not the
  // configured apex: that one redirects, and a gateway callback must not.
  const webhookUrl = `${request.nextUrl.origin}/api/payments/webhook`;
  let paid = 0;
  let failed = 0;
  let pending = 0;

  for (const row of rows) {
    const amount = Number(row.amount);

    // A card saved with another gateway cannot be charged by this one.
    if (row.provider !== provider.id) {
      await db.rpc("fail_payment", {
        p_secret: secret,
        p_payment_id: row.payment_id,
        p_provider: provider.id,
        p_reason: `saved card belongs to ${row.provider}`,
      });
      failed++;
      continue;
    }

    try {
      const charge = await provider.chargeMandate({
        paymentId: row.payment_id,
        mandateRef: row.provider_mandate_ref,
        amount,
        currency: row.currency,
        description: `Maw3ed ${row.plan_id} ${row.period} renewal ${formatAmount(amount)} ${row.currency}`,
        webhookUrl,
      });

      if (charge.outcome === "paid") {
        const { error: confirmError } = await db.rpc("confirm_payment", {
          p_secret: secret,
          p_payment_id: row.payment_id,
          p_amount: Number.isFinite(charge.amount) ? charge.amount : null,
          p_currency: charge.currency,
          p_provider: provider.id,
          p_provider_ref: charge.providerRef,
        });
        if (confirmError) {
          // Charged but not recorded. Left pending on purpose: the
          // gateway's webhook for the same charge will confirm it.
          console.error("renewal charged but confirm failed", { paymentId: row.payment_id, confirmError });
          pending++;
        } else {
          paid++;
        }
      } else if (charge.outcome === "failed") {
        await db.rpc("fail_payment", {
          p_secret: secret,
          p_payment_id: row.payment_id,
          p_provider: provider.id,
          p_reason: charge.reason,
        });
        failed++;
      } else {
        pending++;
      }
    } catch (err) {
      // Unknown outcome: the charge may or may not have happened. Stay
      // pending and let the webhook decide, rather than retry and risk a
      // double charge.
      console.error("renewal charge threw, left pending for the webhook", { paymentId: row.payment_id, err });
      pending++;
    }
  }

  return NextResponse.json({ claimed: rows.length, paid, failed, pending });
}
