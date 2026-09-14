import "server-only";
import type { PaymentProvider, WebhookEvent } from "@/lib/payments";
import {
  PAYTABS_JORDAN_BASE,
  classify,
  isPaymentId,
  packMandate,
  signatureValid,
  unpackMandate,
  type PaytabsTxn,
} from "./paytabsCore";

// PayTabs adapter (hosted payment page). Chosen 2026-09: serves Jordan
// directly, charges in JOD, and gives a test profile at signup with no
// company, so the whole flow runs against the sandbox until the company is
// registered. Environment:
//   PAYTABS_PROFILE_ID   profile id (test profile first)
//   PAYTABS_SERVER_KEY   that profile's server key
//   PAYTABS_BASE_URL     optional; defaults to the Jordan endpoint
//
// Not verified against a live sandbox yet, because no profile exists yet:
// the "authorization: <server key>" header and sending no customer_details
// (the hosted page collects them) follow PayTabs' published samples and
// must be confirmed on the first sandbox payment.

type Config = { profileId: number; serverKey: string; base: string };

function config(): Config | null {
  const profileId = Number(process.env.PAYTABS_PROFILE_ID?.trim());
  const serverKey = process.env.PAYTABS_SERVER_KEY?.trim();
  if (!Number.isInteger(profileId) || profileId <= 0 || !serverKey) return null;
  const base = (process.env.PAYTABS_BASE_URL?.trim() || PAYTABS_JORDAN_BASE).replace(/\/+$/, "");
  return { profileId, serverKey, base };
}

async function call(cfg: Config, path: string, body: Record<string, unknown>): Promise<PaytabsTxn & { redirect_url?: string }> {
  const res = await fetch(`${cfg.base}${path}`, {
    method: "POST",
    headers: { authorization: cfg.serverKey, "content-type": "application/json" },
    body: JSON.stringify({ profile_id: cfg.profileId, ...body }),
    cache: "no-store",
  });
  const text = await res.text();
  let json: (PaytabsTxn & { redirect_url?: string; message?: string }) | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    // handled below
  }
  if (!res.ok || !json) {
    throw new Error(`PayTabs ${path} ${res.status}: ${json?.message ?? text.slice(0, 200)}`);
  }
  return json;
}

export function paytabsProvider(): PaymentProvider | null {
  const cfg = config();
  if (!cfg) return null;

  return {
    id: "paytabs",

    async createCheckout(input) {
      const res = await call(cfg, "/payment/request", {
        tran_type: "sale",
        tran_class: "ecom",
        cart_id: input.paymentId,
        cart_currency: "JOD",
        cart_amount: input.amountJod,
        cart_description: input.description.slice(0, 120),
        paypage_lang: input.lang,
        callback: input.webhookUrl,
        return: input.returnUrl,
        hide_shipping: true,
        // 2 = a 32-character hex token, returned after payment.
        ...(input.saveCard ? { tokenise: 2 } : {}),
      });
      if (!res.redirect_url) throw new Error("PayTabs /payment/request: no redirect_url");
      return { redirectUrl: res.redirect_url };
    },

    async parseWebhook(request): Promise<WebhookEvent | null> {
      const raw = await request.text();
      if (!signatureValid(raw, request.headers.get("signature"), cfg.serverKey)) return null;

      let body: PaytabsTxn;
      try {
        body = JSON.parse(raw);
      } catch {
        return null;
      }
      if (!body.tran_ref || !isPaymentId(body.cart_id)) return null;

      // The signature proves PayTabs sent it; the result is still re-read
      // from PayTabs itself before anything is marked paid.
      const txn = await call(cfg, "/payment/query", { tran_ref: body.tran_ref });
      if (txn.cart_id !== body.cart_id) return null;

      const c = classify({ ...txn, token: txn.token ?? body.token, payment_info: txn.payment_info ?? body.payment_info });
      if (!c) return null;

      if (c.outcome === "paid") {
        return {
          paymentId: body.cart_id,
          outcome: "paid",
          amountJod: c.amountJod,
          providerRef: c.providerRef,
          mandateRef: c.token ? packMandate(c.token, c.providerRef) : null,
          cardLabel: c.cardLabel,
        };
      }
      if (c.outcome === "pending") return { paymentId: body.cart_id, outcome: "pending" };
      return { paymentId: body.cart_id, outcome: "failed", providerRef: c.providerRef, reason: c.reason };
    },

    async chargeMandate(input) {
      const mandate = unpackMandate(input.mandateRef);
      if (!mandate) return { outcome: "failed", reason: "unreadable saved card reference" };

      const res = await call(cfg, "/payment/request", {
        tran_type: "sale",
        tran_class: "recurring",
        cart_id: input.paymentId,
        cart_currency: "JOD",
        cart_amount: input.amountJod,
        cart_description: input.description.slice(0, 120),
        token: mandate.token,
        tran_ref: mandate.tranRef,
        callback: input.webhookUrl,
      });

      const c = classify(res);
      if (!c) return { outcome: "pending", providerRef: null };
      if (c.outcome === "paid") return { outcome: "paid", amountJod: c.amountJod, providerRef: c.providerRef };
      if (c.outcome === "pending") return { outcome: "pending", providerRef: c.providerRef };
      return { outcome: "failed", reason: c.reason };
    },
  };
}
