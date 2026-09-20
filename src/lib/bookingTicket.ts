import "server-only";
import { createClient } from "@/lib/supabase/server";

// A booking ticket (0051). The public booking RPCs refuse a request that
// does not carry one, and only this server can mint them: the database
// checks BOOKING_SECRET against app_config.booking_secret, exactly as the
// payment webhook does with payments_secret.
//
// Why it exists: book_appointment is granted to anon, so anyone could
// call it straight through PostgREST with the key that ships in every
// browser, skipping the per-source ceiling entirely — and a failed
// attempt cost nothing, because every refusal happens before any row is
// written. A ticket is spent on first use, success or failure.
//
// Returns null when the ticket cannot be minted. That is NOT a free pass:
// a null ticket makes the database refuse, except in the one window where
// this code is deployed and 0051 is not applied yet (PGRST202), where the
// pre-0051 signature still accepts the booking.
export type TicketResult =
  | { ok: true; ticket: string | null }
  | { ok: false; error: "book_rate_limited" | "error_generic" };

export async function issueBookingTicket(orgSlug: string, sourceHash: string | null): Promise<TicketResult> {
  const secret = process.env.BOOKING_SECRET;
  if (!secret) {
    console.error("BOOKING_SECRET is not set — public booking cannot be ticketed");
    return { ok: true, ticket: null };
  }
  // The database wants a stable source id; without a usable address we
  // still mint, keyed on the clinic, so the honest customer is served.
  const source = sourceHash ?? `noip:${orgSlug}`;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_booking_ticket", {
    p_secret: secret,
    p_source_hash: source,
    p_org_slug: orgSlug,
  });
  if (error) {
    if (error.message?.includes("rate_limited")) return { ok: false, error: "book_rate_limited" };
    // 0051 not applied yet: book without a ticket, as before.
    if (error.code === "PGRST202") return { ok: true, ticket: null };
    console.error("issue_booking_ticket failed", error);
    return { ok: false, error: "error_generic" };
  }
  return { ok: true, ticket: typeof data === "string" ? data : null };
}
