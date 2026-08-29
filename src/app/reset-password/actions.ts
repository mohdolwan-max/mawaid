"use server";

import { createClient } from "@/lib/supabase/server";

export async function updatePassword(
  _prevState: { error?: string; done?: boolean } | undefined,
  formData: FormData
) {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "reset_password_error" as const };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "reset_password_error" as const };

  return { done: true };
}
