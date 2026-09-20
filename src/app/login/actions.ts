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

  // Where this account actually lives. The page asked for wins (the
  // proxy and /admin both send ?next=); otherwise the account decides.
  //
  // Two owner reports shaped this. First: an admin with no clinic was sent
  // to /dashboard and bounced on to "create a clinic", so /admin had to be
  // typed by hand. Then (2026-09-20) a CUSTOMER signed in here and landed
  // in the clinic setup wizard — this page is the clinic door, but nothing
  // stops a customer using it, and "create your clinic" is the worst
  // possible answer to "I want my bookings".
  if (next) redirect(next);

  const [{ data: context }, { data: isAdmin }, { data: auth }] = await Promise.all([
    supabase.rpc("get_my_context").maybeSingle(),
    supabase.rpc("is_platform_admin"),
    supabase.auth.getUser(),
  ]);

  if (context) redirect("/dashboard");
  if (isAdmin === true) redirect("/admin");

  const user = auth.user;
  if (user) {
    // A customer row, or a signup that has not materialised one yet: both
    // mean a person who books, not a person who runs a clinic.
    const { data: customer } = await supabase
      .from("customers")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (customer || user.user_metadata?.kind === "customer") redirect("/my");
  }

  // Nothing else fits: a new clinic owner who has not set up yet.
  redirect("/onboarding");
}
