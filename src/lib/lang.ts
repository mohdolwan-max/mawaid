import "server-only";
import { cookies } from "next/headers";
import type { Lang } from "@/lib/i18n";

// Namespaced (not just "lang"): cookies on localhost are shared across
// every port, so a generically-named cookie collides with any other local
// project's dev server on the same machine.
export const LANG_COOKIE = "mawaid_lang";

// The root layout can only set <html lang/dir> once (it's the sole place
// App Router renders <html>), so a cookie mirrors the user's chosen
// language for fast reads on every request, including public booking pages
// pre-auth. The language toggle keeps this cookie in sync.
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const value = store.get(LANG_COOKIE)?.value;
  return value === "en" ? "en" : "ar";
}
