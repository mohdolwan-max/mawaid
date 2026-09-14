import "server-only";
import { createClient } from "@supabase/supabase-js";
import { paytabsProvider } from "./paytabs";

// The one seam between this app and a card gateway. A gateway is one
// adapter file plus its keys, and these two switch it on:
//   PAYMENT_PROVIDER  which adapter ("paytabs")
//   PAYMENTS_SECRET   app_config.payments_secret from 0047
// Until everything is set, paymentsReady() is false and every screen says
// card payment is not active, instead of offering a button that fails.
//
// Card details never pass through this app: checkout is the gateway's
// hosted page, and renewals charge a token the gateway keeps.

export type CheckoutInput = {
  paymentId: string;
  /** Read from the database's payment row, never from the browser. */
  amountJod: number;
  description: string;
  customerEmail: string | null;
  customerName: string;
  /** Ask the gateway to keep the card for automatic renewal. */
  saveCard: boolean;
  returnUrl: string;
  webhookUrl: string;
  lang: "ar" | "en";
};

export type WebhookEvent =
  | {
      paymentId: string;
      outcome: "paid";
      /** As the gateway reports it charged, compared with the row in 0047. */
      amountJod: number;
      providerRef: string;
      mandateRef: string | null;
      cardLabel: string | null;
    }
  | { paymentId: string; outcome: "failed"; providerRef: string | null; reason: string }
  /** Not settled yet; the gateway sends another notice when it is. */
  | { paymentId: string; outcome: "pending" };

export type MandateCharge =
  | { outcome: "paid"; amountJod: number; providerRef: string }
  | { outcome: "failed"; reason: string }
  /** The gateway answers later through the webhook. */
  | { outcome: "pending"; providerRef: string | null };

export interface PaymentProvider {
  readonly id: string;
  createCheckout(input: CheckoutInput): Promise<{ redirectUrl: string }>;
  /** Verifies the gateway's signature before trusting a byte of the body.
   *  null = not authentic, or not about a payment of ours. */
  parseWebhook(request: Request): Promise<WebhookEvent | null>;
  chargeMandate(input: {
    paymentId: string;
    mandateRef: string;
    amountJod: number;
    description: string;
    webhookUrl: string;
  }): Promise<MandateCharge>;
}

/** Each returns null when its own keys are missing. */
const ADAPTERS: Record<string, () => PaymentProvider | null> = {
  paytabs: paytabsProvider,
};

export function getPaymentProvider(): PaymentProvider | null {
  const id = process.env.PAYMENT_PROVIDER?.trim();
  if (!id) return null;
  const make = ADAPTERS[id];
  if (!make) {
    console.error(`PAYMENT_PROVIDER=${id} has no adapter`);
    return null;
  }
  const provider = make();
  if (!provider) console.error(`PAYMENT_PROVIDER=${id} is missing its keys`);
  return provider;
}

export function paymentsSecret(): string | null {
  return process.env.PAYMENTS_SECRET?.trim() || null;
}

export function paymentsReady(): boolean {
  return getPaymentProvider() !== null && paymentsSecret() !== null;
}

/** A session-free client for the secret-gated payment functions (0047):
 *  webhooks and the renewal job run with no user, like the cron routes. */
export function paymentsDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
}
