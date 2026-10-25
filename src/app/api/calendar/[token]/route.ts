import { NextResponse } from "next/server";
import { publicSupabase } from "@/lib/supabase/public";
import { buildIcs, feedToken, type IcsEvent } from "@/lib/ics";

// A specialist's (or the clinic's) appointments as an iCalendar feed
// (0070), fetched by Google Calendar, the iPhone calendar or Outlook on
// their own schedule. No session: the long random token in the path is
// the key, checked by calendar_feed_events. An unknown or revoked token
// gets an empty calendar, not an error, so a calendar app quietly shows
// nothing rather than retrying forever.

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  start_at: string;
  end_at: string;
  status: string;
  service: string | null;
  customer_name: string;
  customer_phone: string;
  staff: string;
  notes: string | null;
  updated_at: string;
  org_name: string;
  org_address: string | null;
  feed_name: string;
};

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = feedToken(raw);
  let rows: Row[] = [];
  if (token) {
    const { data, error } = await publicSupabase.rpc("calendar_feed_events", { p_token: token });
    if (error) {
      // A failure must not look like an empty diary: the calendar keeps
      // what it had and tries again later.
      console.error("calendar_feed_events failed", error);
      return new NextResponse("temporarily unavailable", { status: 503, headers: { "Retry-After": "600" } });
    }
    rows = (data as Row[]) ?? [];
  }

  const events: IcsEvent[] = rows.map((r) => ({
    uid: `${r.id}@maw3ed.me`,
    start: r.start_at,
    end: r.end_at,
    summary: [r.service ?? "", r.customer_name].filter(Boolean).join(" — "),
    description: [r.customer_phone, r.staff, r.notes ?? ""].filter(Boolean).join("\n"),
    location: [r.org_name, r.org_address].filter(Boolean).join("، ") || null,
    cancelled: r.status === "cancelled",
    updated: r.updated_at,
  }));
  const name = rows[0]?.feed_name ? `موعد — ${rows[0].feed_name}` : "موعد";

  return new NextResponse(buildIcs({ name, events }), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="maw3ed.ics"',
      // Personal data: never kept by shared caches.
      "Cache-Control": "private, max-age=300",
    },
  });
}
