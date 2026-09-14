-- The platform owner's admin page: KPIs (sales, subscriptions, activity),
-- the lists that need a person's attention, and a few tools that until now
-- meant opening the SQL editor.
--
-- Owner's decisions, 2026-09: one page for the site owner with KPIs and the
-- essentials, a sales dashboard, active and expired subscriptions, and
-- basic tools (not view-only).
--
-- Decided here, and why:
--   * Who is an admin is a table, filled by hand. No self-service path
--     exists or should: see the snippet at the end.
--   * Every admin_* function checks _is_platform_admin() itself. They are
--     granted to authenticated only so the page can call them; a
--     non-admin gets not_authorized, the same as a stranger.
--   * Demo clinics (slug demo-%) are seed data for screenshots. Every KPI
--     leaves them out, so a number on this page is about real clinics.
--   * Days and months follow the offer timezone (Asia/Amman), the same
--     calendar the offers already use.
--   * Every tool writes admin_actions: who, what, when, and the reason
--     they had to type. A manual plan change is a money decision.
--   * A refund done in the gateway is recorded as payments.status
--     'refunded'. confirm_payment treats it as final (re-issued at the end
--     of this file), so a late or retried webhook can never re-apply a
--     payment whose money went back.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Who is an admin, and what admins did.
-- ---------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references auth.users(id) on delete set null,
  action text not null,
  org_id uuid references public.organizations(id) on delete set null,
  target_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);

alter table public.admin_actions enable row level security;
revoke all on public.admin_actions from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Refunds are a status of their own.
-- ---------------------------------------------------------------------
alter table public.payments drop constraint if exists payments_status;
alter table public.payments
  add constraint payments_status check (status in
    ('pending', 'paid', 'failed', 'cancelled', 'needs_refund', 'refunded'));

alter table public.payments add column if not exists refunded_at timestamptz;
alter table public.payments add column if not exists refund_note text;


-- ---------------------------------------------------------------------
-- 3. Helpers.
-- ---------------------------------------------------------------------
create or replace function public._is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.platform_admins a where a.user_id = auth.uid());
$$;

create or replace function public._admin_tz()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.timezone from public.offer_settings s where s.id), 'Asia/Amman');
$$;

-- active (inside the plan, or no end) / grace / lapsed — as 0046 defines them.
create or replace function public._plan_phase(p_plan_expires_at timestamptz)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when p_plan_expires_at is null or now() < p_plan_expires_at then 'active'
           when not public._org_closed(null, p_plan_expires_at) then 'grace'
           else 'lapsed'
         end;
$$;

create or replace function public._admin_log(p_action text, p_org_id uuid, p_target_id uuid, p_detail jsonb)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.admin_actions (admin_id, action, org_id, target_id, detail)
  values (auth.uid(), p_action, p_org_id, p_target_id, coalesce(p_detail, '{}'::jsonb));
$$;

revoke all on function public._is_platform_admin() from public, anon, authenticated;
revoke all on function public._admin_tz() from public, anon, authenticated;
revoke all on function public._plan_phase(timestamptz) from public, anon, authenticated;
revoke all on function public._admin_log(text, uuid, uuid, jsonb) from public, anon, authenticated;

-- The one question the page asks before rendering anything.
drop function if exists public.is_platform_admin();
create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._is_platform_admin();
$$;

revoke all on function public.is_platform_admin() from public, anon, authenticated;
grant execute on function public.is_platform_admin() to authenticated;


-- ---------------------------------------------------------------------
-- 4. The overview: every KPI in one call.
-- ---------------------------------------------------------------------
drop function if exists public.admin_overview();
create function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := public._admin_tz();
  v_today date := (now() at time zone v_tz)::date;
  v_month_start timestamptz := date_trunc('month', now() at time zone v_tz) at time zone v_tz;
  v_prev_month_start timestamptz := (date_trunc('month', now() at time zone v_tz) - interval '1 month') at time zone v_tz;
  v_clinics jsonb;
  v_subs jsonb;
  v_revenue jsonb;
  v_mrr jsonb;
  v_attention jsonb;
  v_offers jsonb;
  v_activity jsonb;
  v_series jsonb;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  select jsonb_build_object(
           'total',   count(*) filter (where o.deleted_at is null),
           'listed',  count(*) filter (where o.deleted_at is null and o.is_listed),
           'new_7d',  count(*) filter (where o.created_at > now() - interval '7 days'),
           'new_30d', count(*) filter (where o.created_at > now() - interval '30 days'),
           'closed',  count(*) filter (where o.deleted_at is not null))
    into v_clinics
  from public.organizations o
  where o.slug not like 'demo-%';

  select jsonb_build_object(
           'paid_active',       count(*) filter (where x.phase = 'active' and not x.is_trial),
           'paid_active_basic', count(*) filter (where x.phase = 'active' and not x.is_trial and x.plan = 'basic'),
           'paid_active_pro',   count(*) filter (where x.phase = 'active' and not x.is_trial and x.plan = 'pro'),
           'no_end',            count(*) filter (where x.plan_expires_at is null),
           'trial_active',      count(*) filter (where x.phase = 'active' and x.is_trial),
           'grace',             count(*) filter (where x.phase = 'grace'),
           'lapsed',            count(*) filter (where x.phase = 'lapsed'),
           'trials_ending_7d',  count(*) filter (where x.phase = 'active' and x.is_trial
                                                   and x.plan_expires_at <= now() + interval '7 days'),
           'paid_ending_7d',    count(*) filter (where x.phase = 'active' and not x.is_trial
                                                   and x.plan_expires_at is not null
                                                   and x.plan_expires_at <= now() + interval '7 days'),
           'auto_renew_on',     (select count(*) from public.billing_mandates m
                                   join public.organizations o2 on o2.id = m.org_id
                                  where m.active and o2.deleted_at is null and o2.slug not like 'demo-%'))
    into v_subs
  from (
    select o.plan, o.is_trial, o.plan_expires_at, public._plan_phase(o.plan_expires_at) as phase
    from public.organizations o
    where o.deleted_at is null and o.slug not like 'demo-%'
  ) x;

  -- Money is summed per currency and never across currencies (0048).
  -- 'paid' only: a refunded payment is not revenue.
  select coalesce(jsonb_agg(jsonb_build_object(
           'currency', r.currency,
           'this_month', r.this_month,
           'last_month', r.last_month,
           'plans_this_month', r.plans_this_month,
           'offers_this_month', r.offers_this_month,
           'payments_this_month', r.payments_this_month,
           'all_time', r.all_time) order by r.all_time desc), '[]'::jsonb)
    into v_revenue
  from (
    select p.currency,
           coalesce(sum(p.amount) filter (where p.paid_at >= v_month_start), 0) as this_month,
           coalesce(sum(p.amount) filter (where p.paid_at >= v_prev_month_start and p.paid_at < v_month_start), 0) as last_month,
           coalesce(sum(p.amount) filter (where p.paid_at >= v_month_start and p.kind = 'plan'), 0) as plans_this_month,
           coalesce(sum(p.amount) filter (where p.paid_at >= v_month_start and p.kind = 'offer'), 0) as offers_this_month,
           count(*) filter (where p.paid_at >= v_month_start) as payments_this_month,
           sum(p.amount) as all_time
    from public.payments p
    join public.organizations o on o.id = p.org_id
    where p.status = 'paid' and o.slug not like 'demo-%'
    group by p.currency
  ) r;

  -- Monthly recurring revenue, estimated from each clinic's latest paid
  -- plan payment that is still running: a yearly payment counts a twelfth.
  -- Manual plans (no payment) are not in it; the page says so.
  select coalesce(jsonb_agg(jsonb_build_object('currency', m.currency, 'amount', round(m.amount, 3), 'clinics', m.clinics)), '[]'::jsonb)
    into v_mrr
  from (
    select lp.currency,
           sum(case when lp.period = 'year' then lp.amount / 12 else lp.amount end) as amount,
           count(*) as clinics
    from (
      select distinct on (p.org_id) p.org_id, p.currency, p.period, p.amount
      from public.payments p
      join public.organizations o on o.id = p.org_id
      where p.kind = 'plan' and p.status = 'paid' and p.plan_ends_at > now()
        and o.deleted_at is null and o.slug not like 'demo-%'
      order by p.org_id, p.paid_at desc
    ) lp
    group by lp.currency
  ) m;

  select jsonb_build_object(
           'needs_refund',     (select count(*) from public.payments where status = 'needs_refund'),
           'failed_7d',        (select count(*) from public.payments where status = 'failed'
                                   and created_at > now() - interval '7 days'),
           'renewal_failures', (select count(*) from public.billing_mandates where failures > 0))
    into v_attention;

  select jsonb_build_object(
           'live_today', count(*) filter (where f.status = 'paid' and v_today between f.start_date and f.end_date),
           'scheduled',  count(*) filter (where f.status = 'paid' and f.start_date > v_today),
           'removed',    count(*) filter (where f.status = 'removed'))
    into v_offers
  from public.offers f
  join public.organizations o on o.id = f.org_id
  where o.slug not like 'demo-%';

  select jsonb_build_object(
           'bookings_7d',   count(*) filter (where a.created_at > now() - interval '7 days'),
           'bookings_30d',  count(*) filter (where a.created_at > now() - interval '30 days'),
           'upcoming',      count(*) filter (where a.status = 'booked' and a.start_at > now()),
           'cancelled_30d', count(*) filter (where a.status = 'cancelled' and a.created_at > now() - interval '30 days'),
           'no_show_30d',   count(*) filter (where a.status = 'no_show' and a.created_at > now() - interval '30 days'))
    into v_activity
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  where o.slug not like 'demo-%';

  v_activity := v_activity || jsonb_build_object(
    'customers_total',   (select count(*) from public.customers),
    'customers_new_30d', (select count(*) from public.customers where created_at > now() - interval '30 days'),
    'reviews_30d',       (select count(*) from public.reviews r join public.organizations o on o.id = r.org_id
                           where r.created_at > now() - interval '30 days' and o.slug not like 'demo-%'),
    -- null when there are no reviews: never 0 stars.
    'avg_rating',        (select round(avg(r.rating)::numeric, 2) from public.reviews r
                            join public.organizations o on o.id = r.org_id
                           where r.hidden_at is null and o.slug not like 'demo-%'));

  select coalesce(jsonb_agg(jsonb_build_object(
           'day', d.day, 'bookings', d.bookings, 'signups', d.signups, 'revenue', d.revenue) order by d.day), '[]'::jsonb)
    into v_series
  from (
    select g.day::date as day,
           (select count(*) from public.appointments a join public.organizations o on o.id = a.org_id
             where o.slug not like 'demo-%' and (a.created_at at time zone v_tz)::date = g.day::date) as bookings,
           (select count(*) from public.organizations o
             where o.slug not like 'demo-%' and (o.created_at at time zone v_tz)::date = g.day::date) as signups,
           (select coalesce(jsonb_object_agg(s.currency, s.total), '{}'::jsonb)
              from (select p.currency, sum(p.amount) as total
                      from public.payments p join public.organizations o on o.id = p.org_id
                     where p.status = 'paid' and o.slug not like 'demo-%'
                       and (p.paid_at at time zone v_tz)::date = g.day::date
                     group by p.currency) s) as revenue
    from generate_series((v_today - 29)::timestamp, v_today::timestamp, interval '1 day') as g(day)
  ) d;

  return jsonb_build_object(
    'generated_at', now(),
    'timezone', v_tz,
    'clinics', v_clinics,
    'subscriptions', v_subs,
    'revenue', v_revenue,
    'mrr', v_mrr,
    'attention', v_attention,
    'offers', v_offers,
    'activity', v_activity,
    'series', v_series);
end;
$$;

revoke all on function public.admin_overview() from public, anon, authenticated;
grant execute on function public.admin_overview() to authenticated;


-- ---------------------------------------------------------------------
-- 5. The lists.
-- ---------------------------------------------------------------------
drop function if exists public.admin_clinics();
create function public.admin_clinics()
returns table (
  id uuid,
  name text,
  slug text,
  city text,
  category text,
  plan text,
  is_trial boolean,
  plan_expires_at timestamptz,
  phase text,
  is_listed boolean,
  is_demo boolean,
  created_at timestamptz,
  deleted_at timestamptz,
  owner_email text,
  services_count int,
  bookings_30d int,
  last_booking_at timestamptz,
  paid_totals jsonb,
  auto_renew boolean,
  card_label text
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
    select o.id, o.name, o.slug, o.city, o.category, o.plan, o.is_trial, o.plan_expires_at,
           case when o.deleted_at is not null then 'closed' else public._plan_phase(o.plan_expires_at) end,
           o.is_listed,
           o.slug like 'demo-%',
           o.created_at,
           o.deleted_at,
           (select u.email::text
              from public.memberships m
              join auth.users u on u.id = m.user_id
             where m.org_id = o.id and m.role = 'owner'
             order by m.created_at
             limit 1),
           (select count(*)::int from public.services s where s.org_id = o.id and s.active),
           (select count(*)::int from public.appointments a
             where a.org_id = o.id and a.created_at > now() - interval '30 days'),
           (select max(a.created_at) from public.appointments a where a.org_id = o.id),
           (select coalesce(jsonb_object_agg(t.currency, t.total), '{}'::jsonb)
              from (select p.currency, sum(p.amount) as total from public.payments p
                     where p.org_id = o.id and p.status = 'paid' group by p.currency) t),
           coalesce((select bm.active from public.billing_mandates bm where bm.org_id = o.id), false),
           (select bm.card_label from public.billing_mandates bm where bm.org_id = o.id)
    from public.organizations o
    order by o.created_at desc
    limit 1000;
end;
$$;

drop function if exists public.admin_payments();
create function public.admin_payments()
returns table (
  id uuid,
  created_at timestamptz,
  paid_at timestamptz,
  org_id uuid,
  org_name text,
  org_slug text,
  kind text,
  plan_id text,
  period text,
  offer_title text,
  amount numeric,
  currency text,
  status text,
  outcome text,
  failure_reason text,
  provider text,
  provider_ref text,
  is_renewal boolean,
  refunded_at timestamptz,
  refund_note text
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
    select p.id, p.created_at, p.paid_at, p.org_id, o.name, o.slug, p.kind, p.plan_id, p.period,
           f.title, p.amount, p.currency, p.status, p.outcome, p.failure_reason, p.provider,
           p.provider_ref, p.is_renewal, p.refunded_at, p.refund_note
    from public.payments p
    join public.organizations o on o.id = p.org_id
    left join public.offers f on f.id = p.offer_id
    order by p.created_at desc
    limit 300;
end;
$$;

drop function if exists public.admin_offers();
create function public.admin_offers()
returns table (
  id uuid,
  org_id uuid,
  org_name text,
  org_slug text,
  title text,
  city text,
  start_date date,
  end_date date,
  total_jod numeric,
  status text,
  paid_at timestamptz,
  removed_reason text
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
    select f.id, f.org_id, o.name, o.slug, f.title, f.city, f.start_date, f.end_date,
           f.total_jod, f.status, f.paid_at, f.removed_reason
    from public.offers f
    join public.organizations o on o.id = f.org_id
    where f.status in ('paid', 'removed', 'needs_refund')
    order by f.start_date desc
    limit 200;
end;
$$;

revoke all on function public.admin_clinics() from public, anon, authenticated;
grant execute on function public.admin_clinics() to authenticated;
revoke all on function public.admin_payments() from public, anon, authenticated;
grant execute on function public.admin_payments() to authenticated;
revoke all on function public.admin_offers() from public, anon, authenticated;
grant execute on function public.admin_offers() to authenticated;


-- ---------------------------------------------------------------------
-- 6. The tools. Each needs a typed reason and is logged.
-- ---------------------------------------------------------------------

-- Activate or extend a plan by hand (a bank transfer, a deal). p_months
-- null = no end date. The same plan continues from its current end, as a
-- paid purchase does (0047); a different plan starts now.
drop function if exists public.admin_set_plan(uuid, text, int, text);
create function public.admin_set_plan(p_org_id uuid, p_plan text, p_months int, p_reason text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_trial boolean;
  v_expires timestamptz;
  v_deleted timestamptz;
  v_new timestamptz;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if not exists (select 1 from public.plans where id = p_plan) then
    raise exception 'admin_bad_plan';
  end if;
  if p_months is not null and (p_months < 1 or p_months > 36) then
    raise exception 'admin_bad_months';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'admin_reason_required';
  end if;

  select o.plan, o.is_trial, o.plan_expires_at, o.deleted_at
    into v_plan, v_trial, v_expires, v_deleted
  from public.organizations o
  where o.id = p_org_id
  for update;

  if not found then
    raise exception 'admin_org_not_found';
  end if;
  if v_deleted is not null then
    raise exception 'admin_org_closed';
  end if;

  if p_months is null then
    v_new := null;
  elsif v_plan = p_plan and v_expires is not null and v_expires > now() then
    v_new := v_expires + make_interval(months => p_months);
  else
    v_new := now() + make_interval(months => p_months);
  end if;

  update public.organizations
     set plan = p_plan, plan_expires_at = v_new, is_trial = false
   where id = p_org_id;

  perform public._admin_log('set_plan', p_org_id, null, jsonb_build_object(
    'plan', p_plan, 'months', p_months,
    'previous_plan', v_plan, 'previous_trial', v_trial, 'previous_expires_at', v_expires,
    'new_expires_at', v_new, 'reason', btrim(p_reason)));

  return v_new;
end;
$$;

drop function if exists public.admin_extend_trial(uuid, int, text);
create function public.admin_extend_trial(p_org_id uuid, p_days int, p_reason text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_trial boolean;
  v_expires timestamptz;
  v_new timestamptz;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if p_days is null or p_days < 1 or p_days > 60 then
    raise exception 'admin_bad_days';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'admin_reason_required';
  end if;

  select o.is_trial, o.plan_expires_at into v_trial, v_expires
  from public.organizations o
  where o.id = p_org_id and o.deleted_at is null
  for update;

  if not found then
    raise exception 'admin_org_not_found';
  end if;
  if not v_trial then
    raise exception 'admin_not_trial';
  end if;

  -- From the later of now and the current end: extending a lapsed trial
  -- gives the days from today, not days already in the past.
  v_new := greatest(coalesce(v_expires, now()), now()) + make_interval(days => p_days);

  update public.organizations set plan_expires_at = v_new where id = p_org_id;

  perform public._admin_log('extend_trial', p_org_id, null, jsonb_build_object(
    'days', p_days, 'previous_expires_at', v_expires, 'new_expires_at', v_new, 'reason', btrim(p_reason)));

  return v_new;
end;
$$;

-- Record a refund already made in the gateway. Only money that could not
-- be applied (needs_refund), or an offer the owner took down.
drop function if exists public.admin_mark_refunded(uuid, text);
create function public.admin_mark_refunded(p_payment_id uuid, p_note text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  pay public.payments;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'admin_reason_required';
  end if;

  select * into pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'admin_payment_not_found';
  end if;

  if not (
    pay.status = 'needs_refund'
    or (pay.status = 'paid' and pay.kind = 'offer'
        and exists (select 1 from public.offers f where f.id = pay.offer_id and f.status = 'removed'))
  ) then
    raise exception 'admin_not_refundable';
  end if;

  update public.payments
     set status = 'refunded', refunded_at = now(), refund_note = btrim(p_note)
   where id = pay.id;

  perform public._admin_log('mark_refunded', pay.org_id, pay.id, jsonb_build_object(
    'previous_status', pay.status, 'amount', pay.amount, 'currency', pay.currency, 'note', btrim(p_note)));

  return 'refunded';
end;
$$;

drop function if exists public.admin_remove_offer(uuid, text);
create function public.admin_remove_offer(p_offer_id uuid, p_reason text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'admin_reason_required';
  end if;

  update public.offers
     set status = 'removed', removed_reason = btrim(p_reason)
   where id = p_offer_id and status = 'paid'
  returning org_id into v_org;

  if v_org is null then
    raise exception 'admin_offer_not_removable';
  end if;

  perform public._admin_log('remove_offer', v_org, p_offer_id, jsonb_build_object('reason', btrim(p_reason)));
  return 'removed';
end;
$$;

revoke all on function public.admin_set_plan(uuid, text, int, text) from public, anon, authenticated;
grant execute on function public.admin_set_plan(uuid, text, int, text) to authenticated;
revoke all on function public.admin_extend_trial(uuid, int, text) from public, anon, authenticated;
grant execute on function public.admin_extend_trial(uuid, int, text) to authenticated;
revoke all on function public.admin_mark_refunded(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_mark_refunded(uuid, text) to authenticated;
revoke all on function public.admin_remove_offer(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_remove_offer(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 7. confirm_payment: copied from 0048, one change (refunded is final).
--    Same signature, so create or replace keeps its grant.
-- ---------------------------------------------------------------------
create or replace function public.confirm_payment(
  p_secret text,
  p_payment_id uuid,
  p_amount numeric,
  p_currency text,
  p_provider text,
  p_provider_ref text,
  p_mandate_ref text default null,
  p_card_label text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  pay public.payments;
  v_deleted timestamptz;
  v_window record;
  v_offer_status text;
begin
  if not public._payments_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;

  select * into pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;

  -- Gateways retry webhooks: the second call changes nothing. A refunded
  -- payment is final too (0049): its money went back, so it is never
  -- applied again.
  if pay.status in ('paid', 'needs_refund', 'refunded') then
    return pay.status;
  end if;

  -- 19 JOD and 19 SAR are not the same payment.
  if p_amount is null or p_currency is null
     or p_amount <> pay.amount or upper(p_currency) <> pay.currency then
    update public.payments
       set status = 'needs_refund', outcome = 'amount_mismatch', paid_at = now(),
           provider = p_provider, provider_ref = p_provider_ref
     where id = pay.id;
    return 'needs_refund';
  end if;

  if pay.kind = 'plan' then
    select o.deleted_at into v_deleted
    from public.organizations o
    where o.id = pay.org_id
    for update;

    if v_deleted is not null then
      update public.payments
         set status = 'needs_refund', outcome = 'org_closed', paid_at = now(),
             provider = p_provider, provider_ref = p_provider_ref
       where id = pay.id;
      return 'needs_refund';
    end if;

    select * into v_window
    from public._plan_purchase_window(pay.org_id, pay.plan_id, pay.period, now());

    update public.organizations
       set plan = pay.plan_id,
           plan_expires_at = v_window.ends_at,
           is_trial = false
     where id = pay.org_id;

    update public.payments
       set status = 'paid', outcome = 'plan_extended', plan_ends_at = v_window.ends_at,
           paid_at = now(), provider = p_provider, provider_ref = p_provider_ref
     where id = pay.id;

    -- A saved card renews what the clinic last paid for.
    update public.billing_mandates
       set plan_id = pay.plan_id, period = pay.period, updated_at = now()
     where org_id = pay.org_id
       and (plan_id <> pay.plan_id or period <> pay.period);

    if pay.save_card and p_mandate_ref is not null then
      insert into public.billing_mandates (org_id, provider, provider_mandate_ref, plan_id, period, card_label)
      values (pay.org_id, p_provider, p_mandate_ref, pay.plan_id, pay.period, p_card_label)
      on conflict (org_id) do update
        set provider = excluded.provider,
            provider_mandate_ref = excluded.provider_mandate_ref,
            plan_id = excluded.plan_id,
            period = excluded.period,
            card_label = coalesce(excluded.card_label, billing_mandates.card_label),
            active = true,
            failures = 0,
            last_error = null,
            updated_at = now();
    end if;

    return 'paid';
  end if;

  v_offer_status := public.mark_offer_paid(pay.offer_id, p_amount, p_provider_ref);

  update public.payments
     set status = case when v_offer_status = 'paid' then 'paid' else 'needs_refund' end,
         outcome = case when v_offer_status = 'paid' then 'offer_paid' else 'offer_' || v_offer_status end,
         paid_at = now(), provider = p_provider, provider_ref = p_provider_ref
   where id = pay.id;

  return case when v_offer_status = 'paid' then 'paid' else 'needs_refund' end;
end;
$$;


-- ---------------------------------------------------------------------
-- Verify, and make yourself the admin.
-- ---------------------------------------------------------------------
-- 1. Become an admin (replace the email with the one you log in with):
--      insert into public.platform_admins (user_id)
--      select id from auth.users where email = 'you@example.com'
--      on conflict do nothing;
--
-- 2. Check it took:
--      select u.email from public.platform_admins a join auth.users u on u.id = a.user_id;
select count(*) as platform_admins from public.platform_admins;
