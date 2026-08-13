"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ensureCustomerProfile } from "@/lib/customer";

function safeNext(raw: string | null | undefined, fallback: string): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : fallback;
}

export async function customerLogin(
  _prev: { error?: string } | undefined,
  formData: FormData
) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""), "/my");

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
  const next = safeNext(String(formData.get("next") ?? ""), "/my");

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
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_HOST?.startsWith("localhost") ? "http" : "https"}://${process.env.NEXT_PUBLIC_SITE_HOST ?? "mawaidy.vercel.app"}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) {
    return { error: error.message };
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
