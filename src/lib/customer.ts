import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type CustomerProfile = {
  user_id: string;
  name: string;
  phone: string;
  email: string | null;
};

export type MyBooking = {
  id: string;
  org_name: string;
  org_slug: string;
  service_name: string;
  start_at: string;
  end_at: string;
  status: string;
  cancel_token: string;
};

// The customers row is the source of truth for "this auth user is a
// customer" (vs an org member). Returns null when signed out or when the
// user is an org account.
export const getCustomerProfile = cache(async (): Promise<CustomerProfile | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("customers")
    .select("user_id, name, phone")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) return null;
  return { ...data, email: user.email ?? null };
});

// Customer signup stores name/phone in user_metadata (the signup form's
// data is gone by the time the email-confirmation callback lands). This
// lazily materializes the customers row on first authenticated visit.
export async function ensureCustomerProfile(): Promise<CustomerProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const existing = await supabase
    .from("customers")
    .select("user_id, name, phone")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing.data) return { ...existing.data, email: user.email ?? null };

  if (user.user_metadata?.kind !== "customer") return null;

  const name = String(user.user_metadata?.name ?? "").trim();
  const phone = String(user.user_metadata?.phone ?? "").trim();
  if (!name || !phone) return null;

  const { data } = await supabase
    .from("customers")
    .upsert({ user_id: user.id, name, phone })
    .select("user_id, name, phone")
    .maybeSingle();

  return data ? { ...data, email: user.email ?? null } : null;
}

export async function listMyBookings(): Promise<MyBooking[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_my_bookings");
  return (data as MyBooking[]) ?? [];
}
