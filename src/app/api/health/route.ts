import { NextResponse } from "next/server";
import { publicSupabase } from "@/lib/supabase/public";

// For an outside monitor (UptimeRobot or similar), called every few
// minutes (0072). 200 when the database answers and no scheduled job is
// late; 503 otherwise, naming only what is wrong ("db", or a job's name).
// Nothing about any clinic, no error text: anyone can call it.

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  let data: unknown;
  try {
    const res = await publicSupabase.rpc("health_status");
    if (res.error) {
      // The function missing (0072 not applied) still means the database
      // answered; the jobs are simply not watched yet.
      if (res.error.code === "PGRST202") {
        return NextResponse.json({ ok: true, jobs: "not_watched" }, { status: 200, headers });
      }
      console.error("health_status failed", res.error);
      return NextResponse.json({ ok: false, problems: ["db"] }, { status: 503, headers });
    }
    data = res.data;
  } catch (e) {
    console.error("health_status threw", e);
    return NextResponse.json({ ok: false, problems: ["db"] }, { status: 503, headers });
  }
  const late =
    data && typeof data === "object" && Array.isArray((data as { late?: unknown }).late)
      ? ((data as { late: unknown[] }).late.filter((x) => typeof x === "string") as string[])
      : [];
  return late.length === 0
    ? NextResponse.json({ ok: true }, { status: 200, headers })
    : NextResponse.json({ ok: false, problems: late }, { status: 503, headers });
}
