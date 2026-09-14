"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/siteUrl";

type SignupError = "password_too_short" | "auth_email_rate_limited" | "auth_already_registered" | "error_generic";

// Supabase's own messages are English sentences that change between
// versions; the owner saw them raw on an Arabic page. Known cases get a
// real message; anything else is logged and shown as a generic failure.
function toSignupError(error: { message: string; code?: string }): SignupError {
  const code = error.code ?? "";
  const msg = error.message.toLowerCase();
  if (code === "over_email_send_rate_limit" || msg.includes("rate limit")) return "auth_email_rate_limited";
  if (code === "user_already_exists" || msg.includes("already registered")) return "auth_already_registered";
  console.error("signup failed", error);
  return "error_generic";
}

export async function signup(
  _prevState: { error?: SignupError; needsEmailConfirm?: boolean } | undefined,
  formData: FormData
) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (password.length < 8) {
    return { error: "password_too_short" as const };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Without this the confirmation link landed on the Site URL without
      // exchanging its code: the email got confirmed, but the owner arrived
      // signed out and had to log in again. The customer signup already
      // did this (src/app/account/actions.ts).
      emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent("/onboarding")}`,
    },
  });

  if (error) {
    return { error: toSignupError(error) };
  }

  if (!data.session) {
    // Email confirmation is required by this Supabase project's auth
    // settings — no session yet, so we can't redirect into the app.
    return { needsEmailConfirm: true };
  }

  redirect("/onboarding");
}
