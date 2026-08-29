import "server-only";
import { createClient } from "@/lib/supabase/server";

// Thin typed wrappers around the DB RPCs in
// supabase/migrations/0004_appointments.sql — no business logic here, the
// SQL functions are the single source of truth (see plan: collapsing
// round trips matters most for anonymous public-page traffic with no
// cached session).

export async function getAvailableSlots(
  orgSlug: string,
  serviceId: string,
  date: string,
  staffId: string | null
): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_org_slug: orgSlug,
    p_service_id: serviceId,
    p_date: date,
    p_staff_id: staffId,
  });
  if (error || !data) return [];
  return (data as { start_at: string }[]).map((r) => r.start_at);
}

export type BookResult =
  | { ok: true; id: string; cancelToken: string }
  | { ok: false; error: string };

export async function bookAppointment(input: {
  orgSlug: string;
  serviceId: string;
  startAt: string;
  customerName: string;
  customerPhone: string;
  staffId: string | null;
  customerEmail: string | null;
  notes: string | null;
}): Promise<BookResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("book_appointment", {
      p_org_slug: input.orgSlug,
      p_service_id: input.serviceId,
      p_start_at: input.startAt,
      p_customer_name: input.customerName,
      p_customer_phone: input.customerPhone,
      p_staff_id: input.staffId,
      p_customer_email: input.customerEmail,
      p_notes: input.notes,
    })
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: parseRpcError(error?.message) };
  }
  const row = data as { id: string; cancel_token: string };
  return { ok: true, id: row.id, cancelToken: row.cancel_token };
}

function parseRpcError(message?: string): string {
  if (!message) return "error_generic";
  if (message.includes("slot_taken")) return "book_slot_taken";
  if (message.includes("rate_limited")) return "book_rate_limited";
  return "error_generic";
}

export async function getBookingByToken(token: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_booking_by_token", { p_cancel_token: token }).maybeSingle();
  return data as
    | {
        id: string;
        org_name: string;
        service_name: string;
        start_at: string;
        end_at: string;
        status: string;
        customer_name: string;
      }
    | null;
}

export async function cancelBookingByToken(token: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("cancel_booking_by_token", { p_cancel_token: token });
  return Boolean(data);
}
