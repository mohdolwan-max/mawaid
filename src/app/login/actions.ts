"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveAuthNext } from "@/lib/authNext";

export async function login(
  _prevState: { error?: "auth_error" | "auth_email_not_confirmed" } | undefined,
  formData: FormData
) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // Same-site paths only, so the login form cannot become an open redirect.
  const next = resolveAuthNext(String(formData.get("next") ?? ""), "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // An unconfirmed email used to read "invalid login details" too, and
    // sent the owner hunting for a wrong password that was never wrong.
    // Only this case is named: for anything else "invalid details" stays,
    // so the form never reveals which emails have accounts.
    if (error.code === "email_not_confirmed") {
      return { error: "auth_email_not_confirmed" as const };
    }
    return { error: "auth_error" as const };
  }

  // Owner report: logging in always went to /dashboard, and an admin
  // account with no clinic was bounced on to "create a clinic", so /admin
  // had to be typed by hand every time. The page asked for comes first
  // (the proxy and /admin both send ?next=); with none, an admin who owns
  // no clinic lands on the admin page.
  if (next) redirect(next);

  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin === true) {
    const { data: context } = await supabase.rpc("get_my_context").maybeSingle();
    if (!context) redirect("/admin");
  }

  redirect("/dashboard");
}
