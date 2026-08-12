"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LANG_COOKIE } from "@/lib/lang";
import type { Lang } from "@/lib/i18n";

export async function toggleLang(current: Lang) {
  const store = await cookies();
  const next: Lang = current === "ar" ? "en" : "ar";
  store.set(LANG_COOKIE, next, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
