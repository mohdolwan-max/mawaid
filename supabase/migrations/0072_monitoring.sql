-- Monitoring (owner, 2026-10-25, item 13 of the roadmap: "الاستقرار: النسخ
-- الاحتياطي والمراقبة"). Backups are the database plan's (Supabase's paid
-- plans keep daily backups and point-in-time recovery; the free plan has
-- none) and are the owner's to switch on. This is the part code can do:
-- knowing when something has stopped.
--
-- Decided here, and why:
--   * Each scheduled job reports every run (job_heartbeats): when it last
--     succeeded, when it last failed and why. A job that stops running
--     reports nothing at all, which is exactly what has to be noticed, so
--     "stale" is judged by how long since the last success, not by errors.
--   * health_status() is public and says only what an outside monitor
--     needs: the database answers, and which jobs are late. No error text,
--     no counts, nothing about any clinic. The detail is the platform
--     admin's (admin_system_status).
--   * Late means: reminders (every 5 minutes) with no success for 20
--     minutes; the account purge (daily) for 26 hours. A job never seen
--     is late once that long has passed since this migration.
-- =====================================================================

create table if not exists public.job_heartbeats (
  job text primary key,
  -- How long without a success before it counts as late.
  max_gap interval not null,
  last_ok_at timestamptz,
  last_fail_at timestamptz,
  last_error text,
  runs bigint not null default 0,
  failures bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint job_heartbeats_error check (last_error is null or char_length(last_error) <= 500)
);

insert into public.job_heartbeats (job, max_gap) values
  ('reminders', interval '20 minutes'),
  ('purge-accounts', interval '26 hours')
on conflict (job) do update set max_gap = excluded.max_gap;

alter table public.job_heartbeats enable row level security;
revoke all on public.job_heartbeats from anon, authenticated;


-- A run reports itself. Gated by the cron secret, like the jobs.
drop function if exists public.record_job_run(text, text, boolean, text);
create function public.record_job_run(p_secret text, p_job text, p_ok boolean, p_detail text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select value into v_secret from public.app_config where key = 'cron_secret';
  if v_secret is null or p_secret is null or p_secret is distinct from v_secret then
    raise exception 'not_authorized';
  end if;
  update public.job_heartbeats h
     set runs = h.runs + 1,
         last_ok_at = case when coalesce(p_ok, false) then now() else h.last_ok_at end,
         last_fail_at = case when coalesce(p_ok, false) then h.last_fail_at else now() end,
         failures = h.failures + case when coalesce(p_ok, false) then 0 else 1 end,
         last_error = case when coalesce(p_ok, false) then h.last_error else left(coalesce(p_detail, 'failed'), 500) end
   where h.job = p_job;
  return found;
end;
$$;

revoke all on function public.record_job_run(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.record_job_run(text, text, boolean, text) to anon, authenticated;


-- For the outside monitor: the database answers, and which jobs are late.
drop function if exists public.health_status();
create function public.health_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'db', true,
    'at', now(),
    'late', coalesce((
      select jsonb_agg(h.job order by h.job)
      from public.job_heartbeats h
      where coalesce(h.last_ok_at, h.created_at) < now() - h.max_gap
    ), '[]'::jsonb));
$$;

revoke all on function public.health_status() from public, anon, authenticated;
grant execute on function public.health_status() to anon, authenticated;


-- For the platform admin: every job with its detail.
drop function if exists public.admin_system_status();
create function public.admin_system_status()
returns table (
  job text,
  last_ok_at timestamptz,
  last_fail_at timestamptz,
  last_error text,
  runs bigint,
  failures bigint,
  late boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  return query
    select h.job, h.last_ok_at, h.last_fail_at, h.last_error, h.runs, h.failures,
           coalesce(h.last_ok_at, h.created_at) < now() - h.max_gap
    from public.job_heartbeats h
    order by h.job;
end;
$$;

revoke all on function public.admin_system_status() from public, anon;
grant execute on function public.admin_system_status() to authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select public.health_status();                                  -- {"db": true, "late": [], ...}
-- select job, max_gap from public.job_heartbeats order by job;    -- purge-accounts 26:00, reminders 00:20
