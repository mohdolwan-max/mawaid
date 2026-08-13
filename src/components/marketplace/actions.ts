"use server";

import { cookies } from "next/headers";
import { CITY_COOKIE } from "@/lib/city";
import { CITIES } from "@/lib/directory";
import { LANG_COOKIE } from "@/lib/lang";
import type { Lang } from "@/lib/i18n";
import { revalidatePath } from "next/cache";

export async function setCityAction(city: string) {
  if (!CITIES.some((c) => c.key === city)) return;
  const store = await cookies();
  store.set(CITY_COOKIE, city, { path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export async function togglePublicLang(current: Lang) {
  const store = await cookies();
  const next: Lang = current === "ar" ? "en" : "ar";
  store.set(LANG_COOKIE, next, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
