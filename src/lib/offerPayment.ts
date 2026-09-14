import "server-only";

// No card gateway is connected yet: the owner has not chosen one
// (2026-09). Until one is, a clinic can prepare an offer, see its preview
// and price, and hold its days, but cannot pay — and every screen says so
// plainly instead of offering a pay button that fails.
//
// Connecting a gateway means two pieces:
//   * a server action that creates the gateway's hosted payment for an
//     order (amount = offers.total_jod) and redirects to it;
//   * a webhook route that verifies the gateway's signature and calls
//     mark_offer_paid(offer_id, amount, reference) with the service-role
//     key. That function is idempotent and refuses a wrong amount.
export const OFFER_PAYMENT_READY: boolean = false;
