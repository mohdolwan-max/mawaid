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

export type BookSegment = {
  id: string;
  cancelToken: string;
  serviceId: string;
  startAt: string;
};

export type BookResult =
  // `segments` carries every appointment the visit created, first one
  // first. A single-service booking has exactly one. It used to be
  // dropped on the floor, which left a guest holding one manage link for
  // a three-service visit — see 0027 section 4.
  | { ok: true; id: string; cancelToken: string; segments: BookSegment[] }
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
  /** Set only after the customer confirms they really do want two
   *  overlapping appointments — one phone legitimately books for a whole
   *  family. See 0026. */
  allowOverlap?: boolean;
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
      p_allow_overlap: input.allowOverlap ?? false,
    })
    .maybeSingle();

  // PGRST202 = no function with these parameters. Happens only in the
  // window between this code deploying and 0026 being applied; retry on
  // the pre-0026 signature so booking never breaks on migration order.
  if (error?.code === "PGRST202") {
    const legacy = await supabase
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
    if (legacy.error || !legacy.data) {
      return { ok: false, error: parseRpcError(legacy.error?.message) };
    }
    const legacyRow = legacy.data as { id: string; cancel_token: string };
    return {
      ok: true,
      id: legacyRow.id,
      cancelToken: legacyRow.cancel_token,
      segments: [{ id: legacyRow.id, cancelToken: legacyRow.cancel_token, serviceId: input.serviceId, startAt: input.startAt }],
    };
  }

  if (error || !data) {
    return { ok: false, error: parseRpcError(error?.message) };
  }
  const row = data as { id: string; cancel_token: string };
  return {
    ok: true,
    id: row.id,
    cancelToken: row.cancel_token,
    segments: [{ id: row.id, cancelToken: row.cancel_token, serviceId: input.serviceId, startAt: input.startAt }],
  };
}

function parseRpcError(message?: string): string {
  if (!message) return "error_generic";
  if (message.includes("slot_taken")) return "book_slot_taken";
  if (message.includes("rate_limited")) return "book_rate_limited";
  if (message.includes("customer_time_conflict")) return "book_customer_conflict";
  return "error_generic";
}

export type BookingRow = {
  id: string;
  org_name: string;
  service_name: string;
  start_at: string;
  end_at: string;
  status: string;
  customer_name: string;
};

// Returns every appointment in the visit, earliest first — one row for an
// ordinary booking, N for a multi-service one. Deliberately NOT
// .maybeSingle(): since 0027 the RPC returns the whole visit, and
// maybeSingle() throws on more than one row.
export async function getBookingVisitByToken(token: string): Promise<BookingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_booking_by_token", { p_cancel_token: token });
  if (error) {
    // Never fold this into "no such booking": the page would 404 and the
    // customer would assume their appointment does not exist.
    console.error("get_booking_by_token failed", error);
    throw error;
  }
  return (data ?? []) as BookingRow[];
}

// Cancels the WHOLE visit, not just the segment the link points at.
// A guest has no bookings list to reach the other segments from, so
// cancelling one of three used to leave two staff holding time for
// someone who believed they had cancelled.
export async function cancelVisitByToken(token: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_visit_by_token", { p_cancel_token: token });
  if (error?.code === "PGRST202") {
    // 0027 not applied yet — fall back to cancelling the single row so
    // the button still does something rather than failing silently.
    return cancelBookingByToken(token);
  }
  if (error) {
    console.error("cancel_visit_by_token failed", error);
    return false;
  }
  return Number(data ?? 0) > 0;
}

export async function cancelBookingByToken(token: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("cancel_booking_by_token", { p_cancel_token: token });
  return Boolean(data);
}

// Slot starts where an entire run of services fits back to back. Falls
// back to the single-service list for one service so the common path
// keeps the cheaper query.
export async function getAvailableSlotsChain(
  orgSlug: string,
  serviceIds: string[],
  date: string,
  staffId: string | null
): Promise<string[]> {
  if (serviceIds.length <= 1) {
    return getAvailableSlots(orgSlug, serviceIds[0], date, staffId);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_available_slots_chain", {
    p_org_slug: orgSlug,
    p_service_ids: serviceIds,
    p_date: date,
    p_staff_id: staffId,
  });

  // 0026 not applied yet: fall back to the first service's real times
  // rather than showing a clinic that looks fully booked on every date.
  if (error?.code === "PGRST202") {
    console.error("get_available_slots_chain missing (0026 unapplied)", error);
    return getAvailableSlots(orgSlug, serviceIds[0], date, staffId);
  }
  // Anything else is a real failure and must not be reported as "no
  // times today" — that is indistinguishable from a fully booked clinic
  // and hides the break completely (ENGINEERING-STANDARDS §1: never
  // swallow an error into empty data). BookingClient's .catch() turns
  // this into a visible error instead.
  if (error) {
    console.error("get_available_slots_chain failed", error);
    throw error;
  }
  return ((data ?? []) as { start_at: string }[]).map((r) => r.start_at);
}

// Books every service in one transaction: either the whole visit lands
// or none of it does, so a customer is never left with half a visit.
// A single-service visit goes through the plain booking function, which
// keeps the common path on the older, simpler RPC and means the chain
// function is only ever reached when it is genuinely needed.
export async function bookAppointmentChain(input: {
  orgSlug: string;
  serviceIds: string[];
  startAt: string;
  customerName: string;
  customerPhone: string;
  staffId: string | null;
  customerEmail: string | null;
  notes: string | null;
  allowOverlap?: boolean;
}): Promise<BookResult> {
  if (input.serviceIds.length === 1) {
    return bookAppointment({
      orgSlug: input.orgSlug,
      serviceId: input.serviceIds[0],
      startAt: input.startAt,
      staffId: input.staffId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail,
      notes: input.notes,
      allowOverlap: input.allowOverlap,
    });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("book_appointment_chain", {
    p_org_slug: input.orgSlug,
    p_service_ids: input.serviceIds,
    p_start_at: input.startAt,
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_staff_id: input.staffId,
    p_customer_email: input.customerEmail,
    p_notes: input.notes,
    p_allow_overlap: input.allowOverlap ?? false,
  });

  const rows = (data ?? []) as {
    id: string;
    cancel_token: string;
    service_id: string;
    start_at: string;
  }[];
  if (error || rows.length === 0) {
    return { ok: false, error: parseRpcError(error?.message) };
  }
  // Every segment is kept. The first one's token addresses the whole
  // visit (get_booking_by_token and cancel_visit_by_token both resolve
  // it through visit_id since 0027), but the caller still needs the rest
  // to list what was actually booked in the confirmation and the email.
  return {
    ok: true,
    id: rows[0].id,
    cancelToken: rows[0].cancel_token,
    segments: rows.map((r) => ({
      id: r.id,
      cancelToken: r.cancel_token,
      serviceId: r.service_id,
      startAt: r.start_at,
    })),
  };
}
