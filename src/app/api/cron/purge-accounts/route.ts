import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Permanently deletes accounts whose 15-day grace period has expired.
// Same shape as /api/cron/reminders: driven by a Supabase pg_cron job,
// gated by CRON_SECRET, and the DB-side purge_due_accounts() re-verifies
// that secret against app_config. Uses a bare anon-key client because
// this runs with no user session.
//
// Daily is frequent enough — the grace period is measured in days, so a
// few hours of drift past the deadline is immaterial.

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase.rpc("purge_due_accounts", { p_secret: secret });

  if (error) {
    console.error("purge_due_accounts failed", error);
    return NextResponse.json({ error: "purge_failed" }, { status: 500 });
  }

  return NextResponse.json({ purged: data ?? 0 });
}
