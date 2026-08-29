"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

// `next` is where /reset-password should send the user back to after
// they set a new password — /login for owners/staff, /account for
// customers (see the two entry points that link here).
export async function requestPasswordReset(
  _prevState: { error?: string; sent?: boolean } | undefined,
  formData: FormData
) {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/login");

  if (!email) return { error: "auth_error" as const };

  const origin =
    (await headers()).get("origin") ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3200");
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(
    `/reset-password?next=${next}`
  )}`;

  const supabase = await createClient();
  // Supabase returns success here even for an unregistered email (by
  // design, so this endpoint can't be used to check who has an
  // account) — the UI always shows "check your email" either way.
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  return { sent: true };
}
