"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(
  _prevState: { error?: "auth_error" | "auth_email_not_confirmed" } | undefined,
  formData: FormData
) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

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

  redirect("/dashboard");
}
