import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Each scheduled job reports every run (0072), so a job that stops is
// noticed by /api/health, and the admin sees why one failed. Never
// throws: reporting must not turn a run into a failure.
export async function recordJobRun(
  supabase: SupabaseClient,
  secret: string,
  job: "reminders" | "purge-accounts",
  ok: boolean,
  detail: string | null
): Promise<void> {
  try {
    const { error } = await supabase.rpc("record_job_run", { p_secret: secret, p_job: job, p_ok: ok, p_detail: detail });
    // PGRST202: 0072 not applied yet; nothing to report into.
    if (error && error.code !== "PGRST202") console.error("record_job_run failed", error);
  } catch (e) {
    console.error("record_job_run threw", e);
  }
}
