import { NextResponse, type NextRequest } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";
import { T } from "@/lib/i18n";

// Sends "your appointment is in ~30 minutes" Web Push notifications.
// Invoked every 5 minutes by a Supabase pg_cron job (Vercel Hobby crons
// only run daily, hence pg_cron). Gated by CRON_SECRET, which the DB-side
// claim_due_reminders() re-verifies against app_config.
//
// Uses a bare @supabase/supabase-js client (anon key, no cookies): this
// runs with no user session, and the RPCs it calls are secret-gated.

export const dynamic = "force-dynamic";

type DueRow = {
  appointment_id: string;
  org_name: string;
  service_name: string;
  start_at: string;
  timezone: string;
  customer_name: string;
  customer_email: string | null;
  org_slug: string;
  cancel_token: string;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
};

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    return NextResponse.json({ error: "vapid_not_configured" }, { status: 500 });
  }
  webpush.setVapidDetails("mailto:info@mawaid.app", vapidPublic, vapidPrivate);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data, error } = await supabase.rpc("claim_due_reminders", { p_secret: secret });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data as DueRow[]) ?? [];
  let sent = 0;
  let pruned = 0;

  for (const row of rows) {
    if (!row.endpoint || !row.p256dh || !row.auth) continue;

    const time = new Date(row.start_at).toLocaleTimeString("ar-SA", {
      timeZone: row.timezone,
      hour: "numeric",
      minute: "2-digit",
    });
    const payload = JSON.stringify({
      title: T.ar.reminder_push_title,
      body: T.ar.reminder_push_body
        .replace("{org}", row.org_name)
        .replace("{service}", row.service_name)
        .replace("{time}", time),
      url: `/${row.org_slug}/booking/${row.cancel_token}`,
    });

    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload
      );
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        // Subscription expired/unsubscribed — prune it.
        await supabase.rpc("delete_push_subscription", { p_secret: secret, p_endpoint: row.endpoint });
        pruned++;
      }
    }
  }

  return NextResponse.json({ claimed: rows.length, sent, pruned });
}
