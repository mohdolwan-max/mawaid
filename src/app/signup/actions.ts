"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signup(
  _prevState: { error?: string; needsEmailConfirm?: boolean } | undefined,
  formData: FormData
) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (password.length < 8) {
    return { error: "password_too_short" as const };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: error.message };
  }

  if (!data.session) {
    // Email confirmation is required by this Supabase project's auth
    // settings — no session yet, so we can't redirect into the app.
    return { needsEmailConfirm: true };
  }

  redirect("/onboarding");
}
