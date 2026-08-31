-- Verifies a freshly built project actually has what the app needs.
--
-- Replaces a counting query that was too loose to mean anything: it
-- counted triggers across every schema, so Supabase's own auth/storage
-- triggers made the number unrecognisable, and it counted functions in
-- public, where the installed extensions live. Counts of the wrong thing
-- look like verification without being it.
--
-- Every row below asserts a specific object or a specific privilege.
-- Run it on the NEW project after full_schema.sql. Every row must say
-- PASS.

with checks as (

  -- the fifteen tables the app owns
  select 'tables' as check_name,
         (select count(*)::text from pg_tables
          where schemaname = 'public'
            and tablename in ('organizations','org_settings','memberships','reserved_slugs',
                              'services','invitations','staff_services','appointments',
                              'customers','reviews','push_subscriptions','staff_time_off',
                              'notifications','account_deletions','app_config')) as actual,
         '15' as expected

  -- the booking path, at the signature 0026/0027 left it at
  union all
  select 'book_appointment(9 args)',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'book_appointment' and p.pronargs = 9), '1'

  -- one row per function added after the original schema — if any of
  -- these is missing, a migration was skipped or ran out of order
  union all
  select 'later migrations landed',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in
            ('book_appointment_chain','get_available_slots_chain','cancel_visit_by_token',
             'list_public_staff_for_services','reschedule_booking','reschedule_booking_by_token',
             '_reschedule','_norm_phone','_customer_busy','_staff_free_for')), '10'

  -- 0029's trigger, on the right table, in the right schema
  union all
  select 'new-booking trigger',
         (select count(*)::text from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          where not t.tgisinternal and n.nspname = 'public'
            and c.relname = 'appointments'), '1'

  -- the notification kinds 0029 and 0030 widened the CHECK to
  union all
  select 'notification kinds',
         (select case when pg_get_constraintdef(con.oid) like '%booking_rescheduled%'
                      then 'ok' else 'stale' end
          from pg_constraint con
          join pg_class rel on rel.oid = con.conrelid
          join pg_namespace n on n.oid = rel.relnamespace
          where n.nspname = 'public' and rel.relname = 'notifications' and con.contype = 'c'
          limit 1), 'ok'

  -- the exclusion constraint that makes double booking impossible
  union all
  select 'no_overlap constraint',
         (select count(*)::text from pg_constraint con
          join pg_class rel on rel.oid = con.conrelid
          where rel.relname = 'appointments' and con.conname = 'no_overlap'), '1'

  -- 0028: the internal helpers must be closed to the public API roles
  union all
  select 'internal helpers closed to anon',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('_norm_phone','_customer_busy','_staff_free_for','_resource_slots')
            and has_function_privilege('anon', p.oid, 'execute')), '0'

  -- and the public ones must still be open, or nobody can book
  union all
  select 'public RPCs open to anon',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('book_appointment','get_available_slots','list_directory_orgs',
                              'get_public_org','list_public_services','get_booking_by_token',
                              'cancel_booking_by_token','cancel_visit_by_token')
            and has_function_privilege('anon', p.oid, 'execute')), '8'

  -- RLS on every table that holds someone's data
  union all
  select 'row level security on',
         (select count(*)::text from pg_tables
          where schemaname = 'public' and rowsecurity
            and tablename in ('organizations','org_settings','memberships','services',
                              'appointments','reviews','notifications')), '7'

  -- 0006 creates the bucket the app uploads logos and covers to
  union all
  select 'org-media bucket',
         (select count(*)::text from storage.buckets where id = 'org-media'), '1'

  -- 0011 moved the default off the original Saudi setting
  union all
  select 'timezone default',
         (select case when column_default like '%Asia/Amman%' then 'ok' else 'wrong' end
          from information_schema.columns
          where table_schema = 'public' and table_name = 'org_settings'
            and column_name = 'timezone'), 'ok'
)

select
  check_name,
  expected,
  coalesce(actual, '(null)') as actual,
  case when actual is not distinct from expected then 'PASS' else '*** FAIL ***' end as result
from checks
order by (actual is not distinct from expected), check_name;
