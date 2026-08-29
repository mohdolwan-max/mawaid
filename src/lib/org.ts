import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LANG_COOKIE } from "@/lib/lang";
import type { OrgContext } from "@/lib/types";

type MyContextRow = {
  org_id: string;
  org_name: string;
  org_slug: string;
  org_address: string | null;
  org_phone: string | null;
  org_logo_url: string | null;
  lang: "ar" | "en";
  timezone: string;
  business_hours: OrgContext["businessHours"];
  slot_interval_minutes: number;
  min_notice_minutes: number;
  max_advance_days: number;
  wizard_done: boolean;
  role: "owner" | "staff";
  deleted_at: string | null;
};

// Loads the signed-in user's organization + settings + role in a single
// Supabase round trip (see supabase/migrations/0001_init.sql —
// get_my_context()). Wrapped in React's cache() because both the (app)
// layout and every page under it call this — cache() dedupes repeat calls
// within a single render pass.
export const requireOrgContext = cache(async (): Promise<OrgContext> => {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_my_context").maybeSingle();

  if (error) {
    // Session cookie present but invalid/expired (get_my_context() raised
    // "not authenticated"). This function runs inside a Server Component
    // render, which cannot write cookies — Next.js silently drops any
    // Set-Cookie attempted here — so calling signOut() directly here can
    // never actually clear the bad cookie. Redirect through a Route
    // Handler instead, which can.
    redirect("/auth/signout");
  }

  if (!data) {
    // Authenticated, but no membership yet — first login after signup.
    redirect("/onboarding");
  }

  const row = data as MyContextRow;

  if (row.deleted_at) {
    redirect("/auth/signout");
  }

  // org_settings.lang is the org's saved default (used e.g. for outbound
  // customer emails, see src/lib/email.ts), but nothing ever updates it —
  // the sidebar's language toggle is a personal, per-browser preference
  // like the public marketplace's, not a shared org setting. The
  // mawaid_lang cookie (same one togglePublicLang/toggleLang write) wins
  // when present; the org default is only the fallback for a first visit.
  const cookieLang = (await cookies()).get(LANG_COOKIE)?.value;
  const lang = cookieLang === "en" || cookieLang === "ar" ? cookieLang : row.lang;

  const ctx: OrgContext = {
    orgId: row.org_id,
    name: row.org_name,
    slug: row.org_slug,
    address: row.org_address,
    phone: row.org_phone,
    logoUrl: row.org_logo_url,
    lang,
    timezone: row.timezone,
    businessHours: row.business_hours,
    slotIntervalMinutes: row.slot_interval_minutes,
    minNoticeMinutes: row.min_notice_minutes,
    maxAdvanceDays: row.max_advance_days,
    wizardDone: row.wizard_done,
    role: row.role,
    deletedAt: row.deleted_at,
  };

  if (!ctx.wizardDone) {
    redirect("/onboarding");
  }

  return ctx;
});
