"use server";

import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/siteUrl";

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

  // Previously built from the request's Origin header (falling back to
  // VERCEL_URL, then a hardcoded localhost) — on production that header
  // wasn't present for this Server Action call, and the fallback chain
  // ended up sending real users a "localhost" link that could never
  // open for them. siteUrl() uses the same NEXT_PUBLIC_SITE_HOST
  // convention already relied on for the booking-confirmation email and
  // customer email-verification redirect (see src/lib/siteUrl.ts).
  const redirectTo = `${siteUrl()}/auth/callback?next=${encodeURIComponent(
    `/reset-password?next=${next}`
  )}`;

  const supabase = await createClient();
  // Supabase returns success here even for an unregistered email (by
  // design, so this endpoint can't be used to check who has an
  // account) — the UI always shows "check your email" either way.
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  return { sent: true };
}
