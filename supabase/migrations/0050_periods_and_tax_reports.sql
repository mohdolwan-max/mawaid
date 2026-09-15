-- Admin periods and a sales report that can go to the tax office.
--
-- Owner's request, 2026-09-15: pick the period on the admin page the way
-- Mahsoob does, and print a detailed report "قابل للتقديم للضريبة". Asked
-- how tax should work, the owner said tax depends on the country, the app
-- may run in several countries with several registrations and several
-- payment channels, and the report header carries the legal name and tax
-- number.
--
-- Decided here, and why:
--   * A tax registration is a row: country, currency, legal name, tax
--     number, rate, invoice prefix. One active registration per currency,
--     because until clinics have a country (0048 names that as not done)
--     the currency is what tells a Jordanian payment from a Saudi one.
--   * Tax is snapshotted on the payment the moment it becomes paid: rate,
--     net, tax, invoice number, buyer name. Changing a rate later never
--     rewrites a report already handed in.
--   * Amounts are what the clinic actually paid, so tax is taken out of
--     the amount (tax-inclusive). Nothing is added on top of money that
--     was never collected.
--   * Invoice numbers run per registration with no gaps: the counter row
--     is locked inside the same transaction that marks the payment paid.
--   * Payments outlive their clinic and offer. The owner: clinics are not
--     deleted for good, an owner deletes the account and the data stays
--     for a while. A tax record must stay longer than "a while", so the
--     links become "on delete set null" and the payment keeps its own copy
--     of the buyer name and item.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tax registrations.
-- ---------------------------------------------------------------------
create table if not exists public.tax_registrations (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  currency text not null,
  legal_name text not null,
  tax_number text not null,
  address text,
  tax_rate numeric(5,2) not null default 0,
  -- The calendar the report's days are counted in.
  timezone text not null default 'Asia/Amman',
  invoice_prefix text not null,
  next_invoice_no bigint not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_reg_country check (country ~ '^[A-Z]{2}$'),
  constraint tax_reg_currency check (currency ~ '^[A-Z]{3}$'),
  constraint tax_reg_rate check (tax_rate >= 0 and tax_rate <= 100),
  constraint tax_reg_legal_name check (char_length(btrim(legal_name)) >= 2),
  constraint tax_reg_tax_number check (char_length(btrim(tax_number)) >= 2),
  constraint tax_reg_prefix check (invoice_prefix ~ '^[A-Z0-9]{1,10}$'),
  constraint tax_reg_next_no check (next_invoice_no >= 1)
);

create unique index if not exists tax_registrations_active_currency
  on public.tax_registrations (currency) where active;
create unique index if not exists tax_registrations_prefix_key
  on public.tax_registrations (invoice_prefix);

alter table public.tax_registrations enable row level security;
revoke all on public.tax_registrations from anon, authenticated;

-- Decimal places a currency is kept in (ISO 4217): the dinars of Jordan,
-- Kuwait, Bahrain, Oman and Iraq have three, the rest of the region two.
create or replace function public._currency_decimals(p_currency text)
returns int
language sql
immutable
set search_path = public
as $$
  select case when upper(p_currency) in ('JOD', 'KWD', 'BHD', 'OMR', 'IQD', 'LYD', 'TND') then 3 else 2 end;
$$;

revoke all on function public._currency_decimals(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. What a payment keeps about itself.
-- ---------------------------------------------------------------------
alter table public.payments add column if not exists tax_registration_id uuid
  references public.tax_registrations(id) on delete restrict;
alter table public.payments add column if not exists invoice_no text;
alter table public.payments add column if not exists invoiced_at timestamptz;
alter table public.payments add column if not exists tax_rate numeric(5,2);
alter table public.payments add column if not exists net_amount numeric(12,3);
alter table public.payments add column if not exists tax_amount numeric(12,3);
alter table public.payments add column if not exists buyer_name text;
alter table public.payments add column if not exists item_title text;

alter table public.payments drop constraint if exists payments_invoice_whole;
alter table public.payments
  add constraint payments_invoice_whole check (
    (invoice_no is null and tax_registration_id is null and invoiced_at is null
       and tax_rate is null and net_amount is null and tax_amount is null)
    or (invoice_no is not null and tax_registration_id is not null and invoiced_at is not null
       and tax_rate is not null and net_amount is not null and tax_amount is not null
       and net_amount + tax_amount = amount)
  );

create unique index if not exists payments_invoice_no_key
  on public.payments (tax_registration_id, invoice_no) where invoice_no is not null;
create index if not exists payments_paid_at_idx on public.payments (paid_at) where paid_at is not null;
create index if not exists payments_refunded_at_idx on public.payments (refunded_at) where refunded_at is not null;

-- Payments outlive the clinic and the offer (see the header).
do $do$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.conrelid = 'public.payments'::regclass
      and con.contype = 'f'
      and att.attname in ('org_id', 'offer_id')
  loop
    execute format('alter table public.payments drop constraint %I', c.conname);
  end loop;
end
$do$;

alter table public.payments alter column org_id drop not null;
alter table public.payments
  add constraint payments_org_id_fkey foreign key (org_id)
  references public.organizations(id) on delete set null;
alter table public.payments
  add constraint payments_offer_id_fkey foreign key (offer_id)
  references public.offers(id) on delete set null;

-- An offer payment whose offer row is gone keeps kind 'offer' and its
-- item_title; only the link may be empty.
alter table public.payments drop constraint if exists payments_shape;
alter table public.payments
  add constraint payments_shape check (
    (kind = 'plan' and plan_id is not null and period is not null and offer_id is null)
    or (kind = 'offer' and plan_id is null and period is null)
  );

-- Money that was taken and applied: paid, or paid and later refunded
-- (a removed offer, 0049). needs_refund money was never applied, so it
-- is not a sale and gets no invoice.
create or replace function public._payment_is_sale(p_status text, p_outcome text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_status = 'paid'
      or (p_status = 'refunded' and p_outcome in ('plan_extended', 'offer_paid'));
$$;

revoke all on function public._payment_is_sale(text, text) from public, anon, authenticated;

create or replace function public._payment_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.tax_registrations;
begin
  if new.buyer_name is null and new.org_id is not null then
    select o.name into new.buyer_name from public.organizations o where o.id = new.org_id;
  end if;
  if new.item_title is null and new.offer_id is not null then
    select f.title into new.item_title from public.offers f where f.id = new.offer_id;
  end if;

  if new.invoice_no is null and public._payment_is_sale(new.status, new.outcome) then
    -- The row lock keeps invoice numbers gapless and unique under
    -- concurrent webhooks.
    select * into r
    from public.tax_registrations t
    where t.active and t.currency = new.currency
    for update;

    if found then
      new.tax_registration_id := r.id;
      new.tax_rate := r.tax_rate;
      new.tax_amount := round(new.amount * r.tax_rate / (100 + r.tax_rate), public._currency_decimals(new.currency));
      new.net_amount := new.amount - new.tax_amount;
      new.invoice_no := r.invoice_prefix || '-' || lpad(r.next_invoice_no::text, 6, '0');
      new.invoiced_at := now();
      -- The name the clinic had when it bought.
      if new.org_id is not null then
        select o.name into new.buyer_name from public.organizations o where o.id = new.org_id;
      end if;
      update public.tax_registrations
         set next_invoice_no = next_invoice_no + 1, updated_at = now()
       where id = r.id;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public._payment_snapshot() from public, anon, authenticated;

drop trigger if exists payments_snapshot on public.payments;
create trigger payments_snapshot
  before insert or update on public.payments
  for each row execute function public._payment_snapshot();

-- Existing rows get their names now, while every clinic still exists.
update public.payments p
   set buyer_name = o.name
  from public.organizations o
 where o.id = p.org_id and p.buyer_name is null;

update public.payments p
   set item_title = f.title
  from public.offers f
 where f.id = p.offer_id and p.item_title is null;


-- ---------------------------------------------------------------------
-- 2b. The period every admin function takes.
-- ---------------------------------------------------------------------
-- A period is two calendar days, both included, at most 366 days apart.
create or replace function public._admin_period_ok(p_from date, p_to date)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_from is not null and p_to is not null and p_to >= p_from and p_to - p_from <= 366;
$$;

revoke all on function public._admin_period_ok(date, date) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Registration tools. Each needs a typed reason and is logged (0049).
-- ---------------------------------------------------------------------
drop function if exists public.admin_tax_registrations();
create function public.admin_tax_registrations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_regs jsonb;
  v_unassigned jsonb;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'country', t.country,
           'currency', t.currency,
           'legal_name', t.legal_name,
           'tax_number', t.tax_number,
           'address', t.address,
           'tax_rate', t.tax_rate,
           'timezone', t.timezone,
           'invoice_prefix', t.invoice_prefix,
           'next_invoice_no', t.next_invoice_no,
           'active', t.active,
           'invoices', (select count(*) from public.payments p where p.tax_registration_id = t.id),
           'updated_at', t.updated_at)
         order by t.active desc, t.country, t.created_at), '[]'::jsonb)
    into v_regs
  from public.tax_registrations t;

  -- Sales with no invoice: paid before a registration existed for their
  -- currency. The page offers to invoice them; it never does it silently.
  select coalesce(jsonb_agg(jsonb_build_object('currency', u.currency, 'count', u.n, 'amount', u.total)
         order by u.currency), '[]'::jsonb)
    into v_unassigned
  from (
    select p.currency, count(*) as n, sum(p.amount) as total
    from public.payments p
    left join public.organizations o on o.id = p.org_id
    where p.invoice_no is null
      and public._payment_is_sale(p.status, p.outcome)
      and (o.slug is null or o.slug not like 'demo-%')
    group by p.currency
  ) u;

  return jsonb_build_object('registrations', v_regs, 'unassigned', v_unassigned);
end;
$$;

-- p_id null creates. Currency and prefix are fixed once a registration
-- has issued an invoice: changing them would break the numbering and
-- move invoices already handed in to another country.
drop function if exists public.admin_save_tax_registration(uuid, text, text, text, text, text, numeric, text, text, boolean, text);
create function public.admin_save_tax_registration(
  p_id uuid,
  p_country text,
  p_currency text,
  p_legal_name text,
  p_tax_number text,
  p_address text,
  p_tax_rate numeric,
  p_timezone text,
  p_invoice_prefix text,
  p_active boolean,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  prev public.tax_registrations;
  saved public.tax_registrations;
  v_constraint text;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'admin_reason_required';
  end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names z where z.name = p_timezone) then
    raise exception 'tax_bad_timezone';
  end if;

  if p_id is not null then
    select * into prev from public.tax_registrations where id = p_id for update;
    if not found then
      raise exception 'tax_not_found';
    end if;
    if exists (select 1 from public.payments p where p.tax_registration_id = p_id)
       and (prev.currency <> upper(btrim(coalesce(p_currency, '')))
            or prev.invoice_prefix <> upper(btrim(coalesce(p_invoice_prefix, '')))) then
      raise exception 'tax_locked_fields';
    end if;
  end if;

  begin
    if p_id is null then
      insert into public.tax_registrations
        (country, currency, legal_name, tax_number, address, tax_rate, timezone, invoice_prefix, active)
      values
        (upper(btrim(p_country)), upper(btrim(p_currency)), btrim(p_legal_name), btrim(p_tax_number),
         nullif(btrim(coalesce(p_address, '')), ''), p_tax_rate, p_timezone,
         upper(btrim(p_invoice_prefix)), coalesce(p_active, true))
      returning * into saved;
    else
      update public.tax_registrations
         set country = upper(btrim(p_country)),
             currency = upper(btrim(p_currency)),
             legal_name = btrim(p_legal_name),
             tax_number = btrim(p_tax_number),
             address = nullif(btrim(coalesce(p_address, '')), ''),
             tax_rate = p_tax_rate,
             timezone = p_timezone,
             invoice_prefix = upper(btrim(p_invoice_prefix)),
             active = coalesce(p_active, true),
             updated_at = now()
       where id = p_id
      returning * into saved;
    end if;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'tax_registrations_prefix_key' then
        raise exception 'tax_prefix_taken';
      end if;
      raise exception 'tax_currency_taken';
    when check_violation or not_null_violation then
      raise exception 'tax_bad_input';
  end;

  perform public._admin_log(
    case when p_id is null then 'tax_registration_create' else 'tax_registration_update' end,
    null, saved.id,
    jsonb_build_object('previous', case when p_id is null then null else to_jsonb(prev) end,
                       'saved', to_jsonb(saved), 'reason', btrim(p_reason)));

  return saved.id;
end;
$$;

-- Invoices the sales of one currency that have none, oldest payment
-- first. Touching the row is enough: the snapshot trigger does the rest.
drop function if exists public.admin_invoice_unassigned(text, text);
create function public.admin_invoice_unassigned(p_currency text, p_reason text)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  rec record;
  v_no text;
  v_count int := 0;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'admin_reason_required';
  end if;
  if not exists (select 1 from public.tax_registrations t where t.active and t.currency = v_currency) then
    raise exception 'tax_no_registration';
  end if;

  for rec in
    select p.id
    from public.payments p
    left join public.organizations o on o.id = p.org_id
    where p.currency = v_currency
      and p.invoice_no is null
      and public._payment_is_sale(p.status, p.outcome)
      and (o.slug is null or o.slug not like 'demo-%')
    order by p.paid_at nulls last, p.created_at
    for update of p
  loop
    update public.payments set invoice_no = null where id = rec.id
    returning invoice_no into v_no;
    if v_no is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  perform public._admin_log('tax_invoice_unassigned', null, null,
    jsonb_build_object('currency', v_currency, 'invoiced', v_count, 'reason', btrim(p_reason)));

  return v_count;
end;
$$;

revoke all on function public.admin_tax_registrations() from public, anon, authenticated;
grant execute on function public.admin_tax_registrations() to authenticated;
revoke all on function public.admin_save_tax_registration(uuid, text, text, text, text, text, numeric, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_save_tax_registration(uuid, text, text, text, text, text, numeric, text, text, boolean, text) to authenticated;
revoke all on function public.admin_invoice_unassigned(text, text) from public, anon, authenticated;
grant execute on function public.admin_invoice_unassigned(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4. The overview for a chosen period.
--
-- Counts of things that happen (money, bookings, sign-ups, failures,
-- reviews) follow the period; states (active subscriptions, grace, MRR,
-- refunds owed, upcoming bookings, offers live today) are "now" whatever
-- the period, and the page labels them that way. Money also comes for the
-- period just before, of the same length, for the comparison.
-- ---------------------------------------------------------------------
drop function if exists public.admin_overview();
drop function if exists public.admin_overview(date, date);
create function public.admin_overview(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := public._admin_tz();
  v_today date := (now() at time zone v_tz)::date;
  v_days int;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
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
  if not public._admin_period_ok(p_from, p_to) then
    raise exception 'admin_bad_period';
  end if;

  v_days := p_to - p_from + 1;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;
  v_prev_start := (p_from - v_days)::timestamp at time zone v_tz;

  select jsonb_build_object(
           'total',    count(*) filter (where o.deleted_at is null),
           'listed',   count(*) filter (where o.deleted_at is null and o.is_listed),
           'new',      count(*) filter (where o.created_at >= v_start and o.created_at < v_end),
           'new_prev', count(*) filter (where o.created_at >= v_prev_start and o.created_at < v_start),
           'closed',   count(*) filter (where o.deleted_at is not null))
    into v_clinics
  from public.organizations o
  where o.slug not like 'demo-%';

  -- States: copied from 0049 unchanged.
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

  -- Per currency, never across (0048). 'paid' only, as in 0049: money
  -- that went back is not revenue. The tax report shows sales and
  -- refunds separately.
  select coalesce(jsonb_agg(jsonb_build_object(
           'currency', r.currency,
           'period', r.period_total,
           'previous', r.previous_total,
           'plans', r.plans,
           'offers', r.offers,
           'payments', r.payments,
           'tax', r.tax,
           'uninvoiced', r.uninvoiced,
           'all_time', r.all_time) order by r.all_time desc), '[]'::jsonb)
    into v_revenue
  from (
    select p.currency,
           coalesce(sum(p.amount) filter (where p.paid_at >= v_start and p.paid_at < v_end), 0) as period_total,
           coalesce(sum(p.amount) filter (where p.paid_at >= v_prev_start and p.paid_at < v_start), 0) as previous_total,
           coalesce(sum(p.amount) filter (where p.paid_at >= v_start and p.paid_at < v_end and p.kind = 'plan'), 0) as plans,
           coalesce(sum(p.amount) filter (where p.paid_at >= v_start and p.paid_at < v_end and p.kind = 'offer'), 0) as offers,
           count(*) filter (where p.paid_at >= v_start and p.paid_at < v_end) as payments,
           coalesce(sum(p.tax_amount) filter (where p.paid_at >= v_start and p.paid_at < v_end), 0) as tax,
           count(*) filter (where p.paid_at >= v_start and p.paid_at < v_end and p.invoice_no is null) as uninvoiced,
           sum(p.amount) as all_time
    from public.payments p
    left join public.organizations o on o.id = p.org_id
    where p.status = 'paid' and (o.slug is null or o.slug not like 'demo-%')
    group by p.currency
  ) r;

  -- A state: copied from 0049 unchanged.
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
           'failed',           (select count(*) from public.payments where status = 'failed'
                                   and created_at >= v_start and created_at < v_end),
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
           'bookings',      count(*) filter (where a.created_at >= v_start and a.created_at < v_end),
           'bookings_prev', count(*) filter (where a.created_at >= v_prev_start and a.created_at < v_start),
           'upcoming',      count(*) filter (where a.status = 'booked' and a.start_at > now()),
           'cancelled',     count(*) filter (where a.status = 'cancelled' and a.created_at >= v_start and a.created_at < v_end),
           'no_show',       count(*) filter (where a.status = 'no_show' and a.created_at >= v_start and a.created_at < v_end))
    into v_activity
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  where o.slug not like 'demo-%';

  v_activity := v_activity || jsonb_build_object(
    'customers_total', (select count(*) from public.customers),
    'customers_new',   (select count(*) from public.customers where created_at >= v_start and created_at < v_end),
    'reviews',         (select count(*) from public.reviews r join public.organizations o on o.id = r.org_id
                         where r.created_at >= v_start and r.created_at < v_end and o.slug not like 'demo-%'),
    -- All reviews, not the period's: null when there are none, never 0 stars.
    'avg_rating',      (select round(avg(r.rating)::numeric, 2) from public.reviews r
                          join public.organizations o on o.id = r.org_id
                         where r.hidden_at is null and o.slug not like 'demo-%'));

  -- One row per day of the period. Grouped once per table and joined to
  -- the days, instead of 0049's three subqueries per day, which a
  -- 366-day period would have run 1,098 times.
  with days as (
    select g::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ),
  b as (
    select (a.created_at at time zone v_tz)::date as day, count(*) as n
    from public.appointments a
    join public.organizations o on o.id = a.org_id
    where o.slug not like 'demo-%' and a.created_at >= v_start and a.created_at < v_end
    group by 1
  ),
  s as (
    select (o.created_at at time zone v_tz)::date as day, count(*) as n
    from public.organizations o
    where o.slug not like 'demo-%' and o.created_at >= v_start and o.created_at < v_end
    group by 1
  ),
  m as (
    select x.day, jsonb_object_agg(x.currency, x.total) as revenue
    from (
      select (p.paid_at at time zone v_tz)::date as day, p.currency, sum(p.amount) as total
      from public.payments p
      left join public.organizations o on o.id = p.org_id
      where p.status = 'paid' and (o.slug is null or o.slug not like 'demo-%')
        and p.paid_at >= v_start and p.paid_at < v_end
      group by 1, 2
    ) x
    group by x.day
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', d.day,
           'bookings', coalesce(b.n, 0),
           'signups', coalesce(s.n, 0),
           'revenue', coalesce(m.revenue, '{}'::jsonb)) order by d.day), '[]'::jsonb)
    into v_series
  from days d
  left join b on b.day = d.day
  left join s on s.day = d.day
  left join m on m.day = d.day;

  return jsonb_build_object(
    'generated_at', now(),
    'timezone', v_tz,
    'from', p_from,
    'to', p_to,
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

revoke all on function public.admin_overview(date, date) from public, anon, authenticated;
grant execute on function public.admin_overview(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Payments in a period, and the tax report.
-- ---------------------------------------------------------------------

drop function if exists public.admin_payments();
drop function if exists public.admin_payments(date, date);
create function public.admin_payments(p_from date, p_to date)
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
  refund_note text,
  invoice_no text,
  tax_amount numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tz text := public._admin_tz();
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if not public._admin_period_ok(p_from, p_to) then
    raise exception 'admin_bad_period';
  end if;

  return query
    select p.id, p.created_at, p.paid_at, p.org_id, coalesce(o.name, p.buyer_name, '—'), o.slug,
           p.kind, p.plan_id, p.period, coalesce(f.title, p.item_title), p.amount, p.currency,
           p.status, p.outcome, p.failure_reason, p.provider, p.provider_ref, p.is_renewal,
           p.refunded_at, p.refund_note, p.invoice_no, p.tax_amount
    from public.payments p
    left join public.organizations o on o.id = p.org_id
    left join public.offers f on f.id = p.offer_id
    where coalesce(p.paid_at, p.created_at) >= (p_from::timestamp at time zone v_tz)
      and coalesce(p.paid_at, p.created_at) < ((p_to + 1)::timestamp at time zone v_tz)
    order by p.created_at desc
    -- PostgREST returns at most 1000 rows; the page says when it hit that.
    limit 1000;
end;
$$;

-- One jsonb value, not rows: a report handed to the tax office cannot be
-- cut at a row cap. Totals are left to the page, which sums these lines,
-- so the summary and the detail can never disagree.
drop function if exists public.admin_tax_report(uuid, date, date);
create function public.admin_tax_report(p_registration_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.tax_registrations;
  v_start timestamptz;
  v_end timestamptz;
  v_sales jsonb;
  v_refunds jsonb;
  v_unassigned jsonb;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if not public._admin_period_ok(p_from, p_to) then
    raise exception 'admin_bad_period';
  end if;

  select * into r from public.tax_registrations where id = p_registration_id;
  if not found then
    raise exception 'tax_not_found';
  end if;

  v_start := p_from::timestamp at time zone r.timezone;
  v_end := (p_to + 1)::timestamp at time zone r.timezone;

  -- Sales by the day the money was taken.
  select coalesce(jsonb_agg(jsonb_build_object(
           'invoice_no', p.invoice_no,
           'invoiced_at', p.invoiced_at,
           'paid_at', p.paid_at,
           'buyer_name', coalesce(p.buyer_name, '—'),
           'kind', p.kind,
           'plan_id', p.plan_id,
           'period', p.period,
           'item_title', p.item_title,
           'provider', p.provider,
           'provider_ref', p.provider_ref,
           'is_renewal', p.is_renewal,
           'amount', p.amount,
           'net_amount', p.net_amount,
           'tax_amount', p.tax_amount,
           'tax_rate', p.tax_rate,
           'status', p.status,
           'refunded_at', p.refunded_at)
         order by p.paid_at, p.invoice_no), '[]'::jsonb)
    into v_sales
  from public.payments p
  where p.tax_registration_id = r.id
    and p.paid_at >= v_start and p.paid_at < v_end;

  -- Refunds by the day the money went back: a credit in this period even
  -- when the sale was in an earlier one.
  select coalesce(jsonb_agg(jsonb_build_object(
           'invoice_no', p.invoice_no,
           'refunded_at', p.refunded_at,
           'paid_at', p.paid_at,
           'buyer_name', coalesce(p.buyer_name, '—'),
           'kind', p.kind,
           'plan_id', p.plan_id,
           'period', p.period,
           'item_title', p.item_title,
           'provider', p.provider,
           'provider_ref', p.provider_ref,
           'amount', p.amount,
           'net_amount', p.net_amount,
           'tax_amount', p.tax_amount,
           'tax_rate', p.tax_rate,
           'refund_note', p.refund_note)
         order by p.refunded_at, p.invoice_no), '[]'::jsonb)
    into v_refunds
  from public.payments p
  where p.tax_registration_id = r.id
    and p.status = 'refunded'
    and p.refunded_at >= v_start and p.refunded_at < v_end;

  -- Sales in this currency and period that carry no invoice: named on the
  -- report, so a missing sale is visible rather than silently absent.
  select jsonb_build_object('count', count(*), 'amount', coalesce(sum(p.amount), 0))
    into v_unassigned
  from public.payments p
  left join public.organizations o on o.id = p.org_id
  where p.currency = r.currency
    and p.invoice_no is null
    and public._payment_is_sale(p.status, p.outcome)
    and (o.slug is null or o.slug not like 'demo-%')
    and p.paid_at >= v_start and p.paid_at < v_end;

  return jsonb_build_object(
    'generated_at', now(),
    'from', p_from,
    'to', p_to,
    'registration', jsonb_build_object(
      'id', r.id, 'country', r.country, 'currency', r.currency, 'legal_name', r.legal_name,
      'tax_number', r.tax_number, 'address', r.address, 'tax_rate', r.tax_rate,
      'timezone', r.timezone, 'invoice_prefix', r.invoice_prefix, 'active', r.active),
    'sales', v_sales,
    'refunds', v_refunds,
    'unassigned', v_unassigned);
end;
$$;

revoke all on function public.admin_payments(date, date) from public, anon, authenticated;
grant execute on function public.admin_payments(date, date) to authenticated;
revoke all on function public.admin_tax_report(uuid, date, date) from public, anon, authenticated;
grant execute on function public.admin_tax_report(uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------
-- 1. The new columns and the trigger:
--      select column_name from information_schema.columns
--      where table_schema = 'public' and table_name = 'payments'
--        and column_name in ('invoice_no', 'tax_amount', 'buyer_name', 'item_title')
--      order by column_name;                       -- 4 rows
--      select tgname from pg_trigger where tgname = 'payments_snapshot';   -- 1 row
--
-- 2. Payments no longer vanish with their clinic:
--      select confdeltype from pg_constraint
--      where conname in ('payments_org_id_fkey', 'payments_offer_id_fkey');  -- n, n
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'payments'
  and column_name in ('invoice_no', 'tax_amount', 'buyer_name', 'item_title')
order by column_name;
