-- Re-point the two cron jobs at the custom domain (maw3ed.me, bought
-- 2026-09-03) instead of mawaidy.vercel.app. The old URL still works
-- today, but it is welded to the Vercel PROJECT NAME — and a rename
-- almost happened once already. The custom domain is the identity we
-- actually own, so the jobs should depend on nothing else.
--
-- www, not the apex: maw3ed.me answers 308 -> www.maw3ed.me, and pg_net
-- does not follow redirects — a job aimed at the apex would "succeed"
-- with a 308 and deliver nothing. www serves 200 directly (verified).
-- Same $job$ shape as 0033; scheduling by an existing name replaces it.
-- =====================================================================

select cron.schedule(
  'mawaid-send-reminders',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url     := 'https://www.maw3ed.me/api/cron/reminders',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' ||
                   coalesce((select value from public.app_config where key = 'cron_secret'), '')
               ),
    body    := '{}'::jsonb
  );
  $job$
);

select cron.schedule(
  'mawaid-purge-accounts',
  '0 3 * * *',
  $job$
  select net.http_post(
    url     := 'https://www.maw3ed.me/api/cron/purge-accounts',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' ||
                   coalesce((select value from public.app_config where key = 'cron_secret'), '')
               ),
    body    := '{}'::jsonb
  );
  $job$
);

-- Verify (same drill as 0033): both rows active with the new URL inside,
-- and ~5 minutes later the newest net._http_response row must be 200.
-- select jobid, jobname, schedule, active, command from cron.job where jobname like 'mawaid-%';
-- select id, status_code, left(content,120), created from net._http_response order by created desc limit 3;
