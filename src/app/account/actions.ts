"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureCustomerProfile } from "@/lib/customer";
import { samePath } from "@/lib/authNext";

// Where a customer lands after login/signup when nothing specific was
// requested. The home page, NOT /my: `next` is only populated when the
// user was bounced here from somewhere particular (proxy.ts sends a
// signed-out visitor from /my to /account?next=/my, and that is carried
// through), so falling back to "my bookings" opened a brand-new account
// on a guaranteed-empty list instead of the marketplace.
const DEFAULT_AFTER_AUTH = "/";

export type CustomerSignupError =
  | "required_field"
  | "password_too_short"
  | "auth_email_rate_limited"
  | "auth_already_registered"
  | "error_generic";

function toCustomerSignupError(error: { message: string; code?: string }): CustomerSignupError {
  const code = error.code ?? "";
  const msg = error.message.toLowerCase();
  if (code === "over_email_send_rate_limit" || msg.includes("rate limit")) return "auth_email_rate_limited";
  if (code === "user_already_exists" || msg.includes("already registered")) return "auth_already_registered";
  console.error("customer signup failed", error);
  return "error_generic";
}

function safeNext(raw: string | null | undefined, fallback: string): string {
  return (raw ? samePath(raw) : null) ?? fallback;
}

export async function customerLogin(
  _prev: { error?: string } | undefined,
  formData: FormData
) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""), DEFAULT_AFTER_AUTH);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "auth_error" as const };
  }

  await ensureCustomerProfile();
  redirect(next);
}

export async function customerSignup(
  _prev: { error?: string; needsEmailConfirm?: boolean } | undefined,
  formData: FormData
) {
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""), DEFAULT_AFTER_AUTH);

  if (!name || !phone) return { error: "required_field" as const };
  if (password.length < 8) return { error: "password_too_short" as const };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Survives until the email-confirmation callback, when
      // ensureCustomerProfile() materializes the customers row from it.
      data: { kind: "customer", name, phone },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_HOST?.startsWith("localhost") ? "http" : "https"}://${process.env.NEXT_PUBLIC_SITE_HOST ?? "maw3ed.me"}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    // Supabase returns English sentences that change between versions,
    // and they were rendered raw on an Arabic page — which also told a
    // stranger whether an address is registered. Same mapping the owner
    // signup uses (src/app/signup/actions.ts). Audit 2026-09-20.
    return { error: toCustomerSignupError(error) };
  }

  if (!data.session) {
    return { needsEmailConfirm: true };
  }

  await ensureCustomerProfile();
  redirect(next);
}

export async function updateCustomerProfile(input: { name: string; phone: string }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("customers")
    .update({ name: input.name.trim(), phone: input.phone.trim(), updated_at: new Date().toISOString() })
    .eq("user_id", user.id);

  revalidatePath("/account");
}
