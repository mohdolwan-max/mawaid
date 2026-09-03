-- CRITICAL. The cron secret gate can be walked straight through.
--
-- claim_due_reminders() and delete_push_subscription() both guard with:
--
--   if p_secret is distinct from (select value from app_config
--                                 where key = 'cron_secret') then ...
--
-- When the cron_secret ROW DOES NOT EXIST the subquery is NULL, and
-- `null is distinct from null` is FALSE — so a caller passing
-- p_secret = null fails the "is distinct" test, the exception is never
-- raised, and the body runs. The gate is not weak; it is absent.
--
-- Confirmed live against the production database (Frankfurt), with a
-- deliberately harmless endpoint so nothing was deleted:
--
--   POST /rest/v1/rpc/delete_push_subscription
--   { "p_secret": null, "p_endpoint": "…does-not-exist" }
--   -> 200  true            (expected: not_authorized)
--
-- claim_due_reminders was NOT executed — it returns every upcoming
-- appointment for every clinic with the customer's name, email and
-- cancel_token, and marks reminders as sent. Its exposure was instead
-- established with a NON-null garbage secret, which correctly raised
-- not_authorized while proving anon reaches the function:
--
--   POST /rest/v1/rpc/claim_due_reminders {"p_secret":"…"}  -> 400 not_authorized
--
-- A cancel_token is a capability: it cancels, reschedules and submits a
-- review for its booking. Treat every token for a currently-upcoming
-- appointment as exposed and rotate it (section 4).
--
-- This exact defect was already fixed for purge_due_accounts in 0025,
-- whose own comment describes this NULL case — the other two functions
-- were simply never swept. That is the whole lesson: a class of bug is
-- not fixed until every instance of it is.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. A secret that actually exists.
--
-- Generated here rather than hard-coded, and only if absent, so re-runs
-- never rotate it out from under a working cron job. Section 5 prints it
-- for copying into CRON_SECRET.
--
-- app_config was verified unreadable by anon (GET /rest/v1/app_config
-- returns []), so storing it here does not itself leak.
-- ---------------------------------------------------------------------
insert into public.app_config (key, value)
values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- 2. Gates that fail CLOSED.
--
-- Three explicit refusals instead of one clever comparison:
--   * stored secret missing  -> refuse (the bug above)
--   * caller passed null     -> refuse (never "matches" anything)
--   * values differ          -> refuse
--
-- Signatures and return types are unchanged, so both keep their grants
-- and the app needs no redeploy for this migration to take effect.
--
-- The anon grant is deliberately KEPT. src/app/api/cron/*/route.ts use a
-- bare anon-key client with no session by design, and the secret is the
-- authorization boundary — that design is sound once the boundary
-- actually holds. Revoking anon would need the service-role key in the
-- app's environment, and that key bypasses RLS entirely: a strictly
-- larger blast radius than the thing being fixed.
-- ---------------------------------------------------------------------
create or replace function public.claim_due_reminders(p_secret text)
returns table (
  appointment_id uuid,
  org_name text,
  service_name text,
  start_at timestamptz,
  timezone text,
  customer_name text,
  customer_email text,
  org_slug text,
  cancel_token uuid,
  endpoint text,
  p256dh text,
  auth text
)
language plpgsql
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

  return query
    with claimed as (
      update public.appointments a
      set reminder_sent_at = now()
      where a.status = 'booked'
        and a.reminder_sent_at is null
        and a.start_at > now()
        and a.start_at <= now() + interval '35 minutes'
      returning a.id, a.org_id, a.service_id, a.start_at,
                a.customer_name, a.customer_email, a.cancel_token
    )
    select c.id, o.name, sv.name, c.start_at, s.timezone,
           c.customer_name, c.customer_email, o.slug, c.cancel_token,
           ps.endpoint, ps.p256dh, ps.auth
    from claimed c
    join public.organizations o on o.id = c.org_id
    join public.org_settings s on s.org_id = c.org_id
    join public.services sv on sv.id = c.service_id
    left join public.push_subscriptions ps on ps.appointment_id = c.id;
end;
$$;

create or replace function public.delete_push_subscription(p_secret text, p_endpoint text)
returns boolean
language plpgsql
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

  delete from public.push_subscriptions where endpoint = p_endpoint;
  return true;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Sweep: is any OTHER function guarding on the same pattern?
--
-- Run this after applying. Anything it returns is the same defect
-- somewhere I have not looked, and should be hardened identically.
-- purge_due_accounts is expected to be absent — 0025 already fixed it.
-- ---------------------------------------------------------------------
-- select p.proname
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
--   and pg_get_functiondef(p.oid) like '%is distinct from (select value from public.app_config%';


-- ---------------------------------------------------------------------
-- 4. Rotate the exposed capability tokens.
--
-- Every cancel_token for a currently-upcoming booking was reachable
-- while the gate was open. Rotating invalidates any that were taken.
--
-- The cost is real and must be understood before running it: any manage
-- link ALREADY SENT to a customer stops working, and they will need a
-- new one. Past and cancelled bookings are left alone — their tokens
-- gate nothing that still matters.
--
-- With no real customers yet this is nearly free, which is exactly why
-- it is worth doing now rather than after launch.
-- ---------------------------------------------------------------------
update public.appointments
   set cancel_token = gen_random_uuid()
 where status = 'booked'
   and start_at > now();


-- ---------------------------------------------------------------------
-- 5. The secret to put in CRON_SECRET.
--
-- Copy the value below into Vercel -> Settings -> Environment Variables
-- -> CRON_SECRET (type: Secret — this one is genuinely secret, unlike
-- the NEXT_PUBLIC_* pair), and into any pg_cron job that calls the
-- reminder route with `Bearer <secret>`. They must match exactly or
-- reminders stop — which is now a loud not_authorized rather than a
-- silent open door.
-- ---------------------------------------------------------------------
select value as cron_secret_copy_this
from public.app_config
where key = 'cron_secret';
