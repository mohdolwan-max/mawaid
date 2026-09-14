import { NextResponse, type NextRequest } from "next/server";
import { getPaymentProvider, paymentsDb, paymentsSecret } from "@/lib/payments";

// The gateway's server-to-server result for a payment. The only place a
// payment becomes paid: the adapter verifies the gateway's signature and
// re-reads the transaction from the gateway, then confirm_payment /
// fail_payment (0047, 0048) apply it with PAYMENTS_SECRET.
//
// Status codes matter here. A 5xx makes the gateway retry, which is what
// we want when the database hiccups; both database functions are safe to
// call twice. A 4xx says "never send this again", used only for a request
// that is not authentic or names no payment of ours.

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const provider = getPaymentProvider();
  const secret = paymentsSecret();
  if (!provider || !secret) {
    return NextResponse.json({ error: "payments_not_configured" }, { status: 503 });
  }

  let event;
  try {
    event = await provider.parseWebhook(request);
  } catch (err) {
    // Includes the gateway's own status API being unreachable: retry later.
    console.error("payment webhook: could not verify", err);
    return NextResponse.json({ error: "unverified" }, { status: 502 });
  }
  if (!event) {
    return NextResponse.json({ error: "not_authentic" }, { status: 400 });
  }
  if (event.outcome === "pending") {
    return NextResponse.json({ status: "pending" });
  }

  const db = paymentsDb();
  const { data, error } =
    event.outcome === "paid"
      ? await db.rpc("confirm_payment", {
          p_secret: secret,
          p_payment_id: event.paymentId,
          // NaN serialises to null, which confirm_payment refuses.
          p_amount: Number.isFinite(event.amount) ? event.amount : null,
          p_currency: event.currency,
          p_provider: provider.id,
          p_provider_ref: event.providerRef,
          p_mandate_ref: event.mandateRef,
          p_card_label: event.cardLabel,
        })
      : await db.rpc("fail_payment", {
          p_secret: secret,
          p_payment_id: event.paymentId,
          p_provider: provider.id,
          p_reason: event.reason,
        });

  if (error) {
    console.error("payment webhook: database refused", { paymentId: event.paymentId, error });
    // payment_not_found will never succeed on retry; everything else might.
    const permanent = error.message.includes("payment_not_found");
    return NextResponse.json({ error: "not_applied" }, { status: permanent ? 404 : 500 });
  }

  if (data === "needs_refund") {
    console.error("payment webhook: paid but could not be applied, needs refund", {
      paymentId: event.paymentId,
      provider: provider.id,
    });
  }
  return NextResponse.json({ status: data });
}
