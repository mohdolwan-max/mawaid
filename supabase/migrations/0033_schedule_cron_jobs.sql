-- The scheduled jobs, which did not survive the move to Frankfurt.
--
-- `select * from cron.job` on the new project fails with
-- 42P01 relation "cron.job" does not exist — the pg_cron extension is not
-- even installed, let alone the jobs. Scheduled jobs are cluster state,
-- not schema: supabase/schema/full_schema.sql replays tables, functions
-- and grants, and carries none of this. So since the migration:
--
--   * no appointment reminder has been sent
--   * no account past its 15-day grace period has been purged
--
-- Neither failure raises anything. Nothing calls the routes, so there is
-- no error to see — the most expensive kind of broken.
--
-- Vercel is not an option for the first one: Hobby crons run at most
-- daily and reminders need every five minutes. That is why this was
-- pg_cron originally, and it stays pg_cron.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Extensions. pg_cron schedules, pg_net makes the outbound call.
--    Both ship with Supabase; these are no-ops if already enabled.
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ---------------------------------------------------------------------
-- 2. The jobs.
--
-- The secret is READ FROM app_config at call time rather than pasted in
-- here. That matters: the same row the RPC checks against is the row the
-- job authenticates with, so the two can never drift apart — and 0032
-- exists precisely because a missing/mismatched secret failed silently.
-- It also keeps the secret out of this file and out of git.
--
-- Rescheduling by name replaces an existing job, so this is safe to
-- re-run; the unschedule below is only for pg_cron versions that would
-- otherwise duplicate.
-- ---------------------------------------------------------------------
do $do$
begin
  perform cron.unschedule('mawaid-send-reminders');
exception when others then
  null;  -- not scheduled yet, which is the normal first-run case
end
$do$;

do $do$
begin
  perform cron.unschedule('mawaid-purge-accounts');
exception when others then
  null;
end
$do$;

-- Every 5 minutes: claim due reminders and push them.
select cron.schedule(
  'mawaid-send-reminders',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url     := 'https://mawaidy.vercel.app/api/cron/reminders',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' ||
                   coalesce((select value from public.app_config where key = 'cron_secret'), '')
               ),
    body    := '{}'::jsonb
  );
  $job$
);

-- Daily at 03:00 UTC (06:00 in Amman — quiet, and comfortably after
-- midnight everywhere the product operates): purge accounts whose grace
-- period has expired.
select cron.schedule(
  'mawaid-purge-accounts',
  '0 3 * * *',
  $job$
  select net.http_post(
    url     := 'https://mawaidy.vercel.app/api/cron/purge-accounts',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' ||
                   coalesce((select value from public.app_config where key = 'cron_secret'), '')
               ),
    body    := '{}'::jsonb
  );
  $job$
);


-- ---------------------------------------------------------------------
-- 3. Check it registered. Two rows, both active.
-- ---------------------------------------------------------------------
select jobid, jobname, schedule, active
from cron.job
where jobname like 'mawaid-%'
order by jobname;


-- ---------------------------------------------------------------------
-- 4. Five minutes later, confirm it actually FIRED — scheduling is not
--    the same as working, and this is the step that would otherwise be
--    skipped.
--
-- status 'succeeded' means pg_cron ran the command. To see what the
-- endpoint answered, join net._http_response; a 401 there means the
-- secret in CRON_SECRET on Vercel does not match app_config.
-- ---------------------------------------------------------------------
-- select j.jobname, r.status, r.return_message, r.start_time
-- from cron.job_run_details r
-- join cron.job j on j.jobid = r.jobid
-- where j.jobname like 'mawaid-%'
-- order by r.start_time desc
-- limit 10;
--
-- select id, status_code, left(content, 200) as body, created
-- from net._http_response
-- order by created desc
-- limit 5;
