-- Countries ("markets"): one platform, a clinic's country decides how it
-- pays.
--
-- Owner's decisions, 2026-09-28:
--   * A clinic chooses its country when it signs up, and everything follows
--     from it: the gateway account, the currency, the price list, the tax
--     registration and its invoices, the cities, the timezone.
--   * Prices are set per country in that country's currency by the owner.
--     Nothing is converted from JOD.
--   * A clinic's country is locked once it has an invoice; only the
--     platform admin moves it, with a typed reason that is logged.
--   * Customers get their country from where they are (the page does that,
--     from the request's IP country; nothing here).
--   * The admin area works per country and never adds JOD to SAR.
--   * Jordan runs as today. Saudi Arabia is prepared and CLOSED: it opens
--     from the admin page once its prices, offer settings and an active
--     tax registration exist, and only then.
--
-- Decided here, and why:
--   * markets holds the switches (open for sign-up, shown to customers) and
--     the facts a payment needs (currency, timezone). Cities are rows too,
--     so a clinic's city can be checked against its country: a Jordanian
--     clinic listed in Riyadh would show dinar prices to Saudi customers.
--   * A missing price is "not for sale here", never 0. plan_prices has no
--     row for a plan a country does not sell yet.
--   * plans loses its price columns and offer_settings becomes one row per
--     country, so there is one place each number lives.
--   * Every payment records its country, and invoicing picks the active
--     tax registration of that country (0050 used the currency, as a
--     stand-in until clinics had a country).
--   * The admin functions take an optional country. Counts may be added
--     across countries; money is always returned per currency.
--
-- Not done here, and named so nobody mistakes it for done (phase 2, before
-- Saudi Arabia opens):
--   * phone numbers are still normalised the Jordanian way (_norm_phone,
--     0027). A Saudi clinic's customers need +966 handling first.
--   * ZATCA phase-1 invoice fields (buyer VAT number and address, the QR
--     code). The seller side is already the tax registration.
--
-- Order: run this BEFORE pushing the code that uses it. Several functions
-- change their result or parameter names, so the pages still running the
-- previous code show "could not load" on billing, offers and admin until
-- the new deploy is live, a minute or two. There are no real payments yet.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Countries and their cities.
-- ---------------------------------------------------------------------
create table if not exists public.markets (
  code text primary key,
  name_ar text not null,
  name_en text not null,
  currency text not null,
  timezone text not null,
  dial_code text not null,
  signup_open boolean not null default false,
  listed boolean not null default false,
  sort int not null default 100,
  updated_at timestamptz not null default now(),
  constraint markets_code check (code ~ '^[A-Z]{2}$'),
  constraint markets_currency check (currency ~ '^[A-Z]{3}$'),
  constraint markets_dial_code check (dial_code ~ '^[0-9]{1,4}$')
);

alter table public.markets enable row level security;
revoke all on public.markets from anon, authenticated;

-- DO NOTHING: re-running this file must never reopen or close a country
-- the owner switched by hand.
insert into public.markets (code, name_ar, name_en, currency, timezone, dial_code, signup_open, listed, sort) values
  ('JO', 'الأردن', 'Jordan', 'JOD', 'Asia/Amman', '962', true, true, 1),
  ('SA', 'السعودية', 'Saudi Arabia', 'SAR', 'Asia/Riyadh', '966', false, false, 2)
on conflict (code) do nothing;

-- Mirrored by CITIES in src/lib/directory.ts: a city added there must be
-- added here in the same change, or clinics in it cannot save.
create table if not exists public.market_cities (
  city text primary key,
  country text not null references public.markets(code),
  constraint market_cities_key check (city ~ '^[a-z][a-z_]{1,40}$')
);

alter table public.market_cities enable row level security;
revoke all on public.market_cities from anon, authenticated;

insert into public.market_cities (city, country) values
  ('amman', 'JO'), ('zarqa', 'JO'), ('irbid', 'JO'), ('russeifa', 'JO'), ('aqaba', 'JO'),
  ('salt', 'JO'), ('mafraq', 'JO'), ('karak', 'JO'), ('madaba', 'JO'), ('jerash', 'JO'),
  ('riyadh', 'SA'), ('jeddah', 'SA'), ('makkah', 'SA'), ('madinah', 'SA'), ('dammam', 'SA'),
  ('khobar', 'SA'), ('dhahran', 'SA'), ('al_ahsa', 'SA'), ('jubail', 'SA'), ('taif', 'SA'),
  ('abha', 'SA'), ('khamis_mushait', 'SA'), ('tabuk', 'SA'), ('buraidah', 'SA'), ('hail', 'SA'),
  ('jazan', 'SA'), ('najran', 'SA'), ('yanbu', 'SA')
on conflict (city) do nothing;

create or replace function public._market_listed(p_country text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select m.listed from public.markets m where m.code = p_country), false);
$$;

create or replace function public._market_tz(p_country text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select m.timezone from public.markets m where m.code = p_country), 'Asia/Amman');
$$;

revoke all on function public._market_listed(text) from public, anon, authenticated;
revoke all on function public._market_tz(text) from public, anon, authenticated;

-- Public: which countries exist and which are open. Nothing here is
-- secret; the sign-up page and the city picker read it.
drop function if exists public.list_markets();
create function public.list_markets()
returns table (
  code text,
  name_ar text,
  name_en text,
  currency text,
  dial_code text,
  signup_open boolean,
  listed boolean,
  sort int
)
language sql
stable
security definer
set search_path = public
as $$
  select m.code, m.name_ar, m.name_en, m.currency, m.dial_code, m.signup_open, m.listed, m.sort
  from public.markets m
  order by m.sort, m.code;
$$;

revoke all on function public.list_markets() from public, anon, authenticated;
grant execute on function public.list_markets() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. A clinic's country.
-- ---------------------------------------------------------------------
alter table public.organizations
  add column if not exists country text not null default 'JO' references public.markets(code);

create index if not exists organizations_country_idx on public.organizations (country);

-- The owner's column grant (0034) does not include country, so from a
-- session it cannot be written at all. Only definer functions set it:
-- create_organization on sign-up and admin_move_org_country later. This
-- trigger is the lock both must pass, and it keeps the city inside the
-- country whoever writes it.
create or replace function public._org_country_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.country is distinct from old.country then
    if exists (select 1 from public.payments p where p.org_id = old.id and p.invoice_no is not null)
       and coalesce(current_setting('mawaid.country_move', true), '') <> 'on' then
      raise exception 'org_country_locked';
    end if;
  end if;

  -- Checked only when the city or the country actually changes, so a
  -- clinic saved before cities were checked can still save its other
  -- fields.
  if new.city is not null
     and (tg_op = 'INSERT' or new.city is distinct from old.city or new.country is distinct from old.country)
     and not exists (select 1 from public.market_cities c where c.city = new.city and c.country = new.country) then
    raise exception 'org_city_country';
  end if;

  return new;
end;
$$;

revoke all on function public._org_country_guard() from public, anon, authenticated;

drop trigger if exists org_country_guard on public.organizations;
create trigger org_country_guard
  before insert or update on public.organizations
  for each row execute function public._org_country_guard();

-- The clinic's calendar follows its country when it moves.
create or replace function public._org_country_tz()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.org_settings
     set timezone = public._market_tz(new.country)
   where org_id = new.id;
  return new;
end;
$$;

revoke all on function public._org_country_tz() from public, anon, authenticated;

drop trigger if exists org_country_tz on public.organizations;
create trigger org_country_tz
  after update of country on public.organizations
  for each row
  when (new.country is distinct from old.country)
  execute function public._org_country_tz();

-- Sign-up: 0001's function plus the country, which must be open, and the
-- calendar set from it. The two-argument call the old onboarding page makes
-- still works and means Jordan.
drop function if exists public.create_organization(text, text);
drop function if exists public.create_organization(text, text, text);
create function public.create_organization(p_name text, p_slug text, p_country text default 'JO')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_slug text := lower(trim(p_slug));
  v_country text := upper(btrim(coalesce(p_country, '')));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (select 1 from public.markets m where m.code = v_country and m.signup_open) then
    raise exception 'country_not_open';
  end if;

  if v_slug is null or v_slug = '' or v_slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' then
    raise exception 'invalid_slug';
  end if;

  if exists (select 1 from public.reserved_slugs where slug = v_slug) then
    raise exception 'slug_reserved';
  end if;

  insert into public.organizations (name, slug, country) values (nullif(trim(p_name), ''), v_slug, v_country)
  returning id into v_org_id;

  insert into public.memberships (org_id, user_id, role) values (v_org_id, auth.uid(), 'owner');

  insert into public.org_settings (org_id, timezone) values (v_org_id, public._market_tz(v_country));

  return v_org_id;
exception
  when unique_violation then
    raise exception 'slug_taken';
end;
$$;

revoke all on function public.create_organization(text, text, text) from public, anon, authenticated;
grant execute on function public.create_organization(text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Payments carry their country.
-- ---------------------------------------------------------------------
alter table public.payments add column if not exists country text references public.markets(code);

update public.payments p
   set country = coalesce((select o.country from public.organizations o where o.id = p.org_id), 'JO')
 where p.country is null;

alter table public.payments alter column country set not null;

create index if not exists payments_country_paid_idx on public.payments (country, paid_at) where paid_at is not null;

-- One active registration per COUNTRY now (0050 said per currency only
-- because clinics had no country yet).
drop index if exists public.tax_registrations_active_currency;
create unique index if not exists tax_registrations_active_country
  on public.tax_registrations (country) where active;

-- 0050's snapshot, choosing the registration by the payment's country.
-- The currency must match too: a registration never invoices money in a
-- currency it does not declare.
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
    where t.active and t.country = new.country and t.currency = new.currency
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


-- ---------------------------------------------------------------------
-- 4. Plan prices per country.
-- ---------------------------------------------------------------------
create table if not exists public.plan_prices (
  plan_id text not null references public.plans(id) on delete cascade,
  country text not null references public.markets(code),
  price_month numeric(10,3) not null,
  price_year numeric(10,3) not null,
  updated_at timestamptz not null default now(),
  primary key (plan_id, country),
  constraint plan_prices_positive check (price_month > 0 and price_year > 0)
);

alter table public.plan_prices enable row level security;
revoke all on public.plan_prices from anon, authenticated;

-- Jordan keeps exactly the prices it has today. Guarded, so a second run
-- after the columns are gone does nothing.
do $do$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'plans' and column_name = 'price_month_jod'
  ) then
    insert into public.plan_prices (plan_id, country, price_month, price_year)
    select p.id, 'JO', p.price_month_jod, p.price_year_jod
    from public.plans p
    where p.price_month_jod > 0 and p.price_year_jod > 0
    on conflict (plan_id, country) do nothing;

    alter table public.plans drop column price_month_jod;
    alter table public.plans drop column price_year_jod;
  end if;
end
$do$;

-- A clinic's price for a plan and period, in its country. Null when that
-- country does not sell the plan: never 0.
create or replace function public._org_plan_price(p_org_id uuid, p_plan text, p_period text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case p_period when 'year' then pp.price_year when 'month' then pp.price_month end
  from public.organizations o
  join public.plan_prices pp on pp.country = o.country and pp.plan_id = p_plan
  where o.id = p_org_id;
$$;

revoke all on function public._org_plan_price(uuid, text, text) from public, anon, authenticated;

-- Public: the pricing page, for one country. Plans the country does not
-- sell come back with null prices, never 0.
drop function if exists public.list_plans();
drop function if exists public.list_plans(text);
create function public.list_plans(p_country text default 'JO')
returns table (
  id text,
  sort int,
  max_staff int,
  sms_per_month int,
  price_month numeric,
  price_year numeric,
  currency text,
  featured boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.sort, p.max_staff, p.sms_per_month, pp.price_month, pp.price_year, m.currency, p.featured
  from public.plans p
  join public.markets m on m.code = upper(btrim(coalesce(p_country, 'JO')))
  left join public.plan_prices pp on pp.plan_id = p.id and pp.country = m.code
  order by p.sort;
$$;

revoke all on function public.list_plans(text) from public, anon, authenticated;
grant execute on function public.list_plans(text) to anon, authenticated;

-- 0047's window, with the credit for the unused days of another plan
-- priced in the clinic's own country.
create or replace function public._plan_purchase_window(
  p_org_id uuid,
  p_plan text,
  p_period text,
  p_now timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz, credit_seconds bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_trial boolean;
  v_expires timestamptz;
  v_old_price numeric;
  v_new_price numeric;
  v_start timestamptz;
  v_credit bigint := 0;
begin
  select o.plan, o.is_trial, o.plan_expires_at
    into v_plan, v_trial, v_expires
  from public.organizations o
  where o.id = p_org_id;

  if v_plan = p_plan and v_expires is not null and v_expires > p_now then
    v_start := v_expires;
  else
    v_start := p_now;
  end if;

  if v_plan is distinct from p_plan and not v_trial
     and v_expires is not null and v_expires > p_now then
    v_old_price := public._org_plan_price(p_org_id, v_plan, 'month');
    v_new_price := public._org_plan_price(p_org_id, p_plan, 'month');
    if v_old_price > 0 and v_new_price > 0 then
      v_credit := floor(extract(epoch from (v_expires - p_now)) * v_old_price / v_new_price)::bigint;
    end if;
  end if;

  return query
    select v_start,
           v_start
             + case p_period when 'year' then interval '1 year' else interval '1 month' end
             + make_interval(secs => v_credit),
           v_credit;
end;
$$;

drop function if exists public.plan_purchase_options();
create function public.plan_purchase_options()
returns table (
  plan_id text,
  period text,
  amount numeric,
  currency text,
  starts_at timestamptz,
  ends_at timestamptz,
  credit_days int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_country text;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;

  select o.country into v_country from public.organizations o where o.id = v_org;

  return query
    select p.id,
           per.period,
           case per.period when 'year' then pp.price_year else pp.price_month end,
           m.currency,
           w.starts_at,
           w.ends_at,
           (w.credit_seconds / 86400)::int
    from public.plans p
    join public.plan_prices pp on pp.plan_id = p.id and pp.country = v_country
    join public.markets m on m.code = v_country
    cross join (values ('month', 1), ('year', 2)) as per(period, ord)
    cross join lateral public._plan_purchase_window(v_org, p.id, per.period, now()) w
    order by p.sort, per.ord;
end;
$$;

drop function if exists public.start_plan_payment(text, text, boolean);
create function public.start_plan_payment(p_plan text, p_period text, p_save_card boolean default false)
returns table (payment_id uuid, amount numeric, currency text, country text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_country text;
  v_currency text;
  v_amount numeric;
  v_id uuid;
begin
  v_org := public._my_owner_org();
  if v_org is null or exists (
    select 1 from public.organizations o where o.id = v_org and o.deleted_at is not null
  ) then
    raise exception 'not_authorized';
  end if;

  if p_period is null or p_period not in ('month', 'year') then
    raise exception 'payment_bad_period';
  end if;

  select o.country, m.currency into v_country, v_currency
  from public.organizations o
  join public.markets m on m.code = o.country
  where o.id = v_org;

  v_amount := public._org_plan_price(v_org, p_plan, p_period);
  if v_amount is null or v_amount <= 0 then
    raise exception 'payment_bad_plan';
  end if;

  insert into public.payments (org_id, kind, plan_id, period, amount, currency, country, save_card, created_by)
  values (v_org, 'plan', p_plan, p_period, v_amount, v_currency, v_country, coalesce(p_save_card, false), auth.uid())
  returning id into v_id;

  return query select v_id, v_amount, v_currency, v_country;
end;
$$;

revoke all on function public.plan_purchase_options() from public, anon, authenticated;
grant execute on function public.plan_purchase_options() to authenticated;
revoke all on function public.start_plan_payment(text, text, boolean) from public, anon, authenticated;
grant execute on function public.start_plan_payment(text, text, boolean) to authenticated;

-- The renewal job (0048), charging each clinic its own country's price in
-- its currency. A clinic whose country no longer sells the plan is not
-- charged: its plan ends and grace applies, as with a failed card.
drop function if exists public.claim_due_renewals(text);
create function public.claim_due_renewals(p_secret text)
returns table (
  payment_id uuid,
  org_id uuid,
  provider text,
  provider_mandate_ref text,
  plan_id text,
  period text,
  amount numeric,
  currency text,
  country text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public._payments_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;

  return query
    with due as (
      select m.org_id, m.provider, m.provider_mandate_ref, m.plan_id, m.period,
             case m.period when 'year' then pp.price_year else pp.price_month end as due_amount,
             mk.currency as due_currency,
             o.country as due_country
      from public.billing_mandates m
      join public.organizations o on o.id = m.org_id
      join public.plan_prices pp on pp.plan_id = m.plan_id and pp.country = o.country
      join public.markets mk on mk.code = o.country
      where m.active
        and o.deleted_at is null
        and o.plan_expires_at is not null
        and o.plan_expires_at <= now() + interval '1 day'
        and not exists (
          select 1 from public.payments x
          where x.org_id = m.org_id and x.is_renewal
            and (x.status = 'pending' or x.created_at > now() - interval '20 hours')
        )
      for update of m skip locked
    ),
    created as (
      insert into public.payments (org_id, kind, plan_id, period, amount, currency, country, provider, save_card, is_renewal)
      select d.org_id, 'plan', d.plan_id, d.period, d.due_amount, d.due_currency, d.due_country, d.provider, true, true
      from due d
      returning id, org_id, currency, country
    )
    select c.id, d.org_id, d.provider, d.provider_mandate_ref, d.plan_id, d.period, d.due_amount, c.currency, c.country
    from created c
    join due d on d.org_id = c.org_id;
end;
$$;

revoke all on function public.claim_due_renewals(text) from public, anon, authenticated;
grant execute on function public.claim_due_renewals(text) to anon;

drop function if exists public._billing_currency();


-- ---------------------------------------------------------------------
-- 5. Offer settings per country, and offers in their currency.
-- ---------------------------------------------------------------------
do $do$
begin
  -- 0045's single row becomes Jordan's row.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'offer_settings' and column_name = 'id'
  ) then
    alter table public.offer_settings add column if not exists country text;
    update public.offer_settings set country = 'JO' where country is null;
    alter table public.offer_settings drop constraint if exists offer_settings_single_row;
    alter table public.offer_settings drop constraint if exists offer_settings_pkey;
    alter table public.offer_settings drop column id;
    alter table public.offer_settings alter column country set not null;
    alter table public.offer_settings add primary key (country);
    alter table public.offer_settings
      add constraint offer_settings_country_fkey foreign key (country) references public.markets(code);
    -- The day an offer runs is a calendar day in its country's timezone,
    -- which markets holds.
    alter table public.offer_settings drop column if exists timezone;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'offer_settings' and column_name = 'price_per_day_jod'
  ) then
    alter table public.offer_settings rename column price_per_day_jod to price_per_day;
    alter table public.offer_settings alter column price_per_day type numeric(10,3);
    alter table public.offer_settings alter column price_per_day drop default;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'offers' and column_name = 'total_jod'
  ) then
    alter table public.offers rename column price_per_day_jod to price_per_day;
    alter table public.offers rename column total_jod to total;
    alter table public.offers alter column price_per_day type numeric(10,3);
    alter table public.offers alter column total type numeric(12,3);
  end if;
end
$do$;

alter table public.offer_settings add column if not exists updated_at timestamptz not null default now();

alter table public.offers add column if not exists currency text;
update public.offers f
   set currency = coalesce((
     select m.currency from public.organizations o join public.markets m on m.code = o.country
     where o.id = f.org_id), 'JOD')
 where f.currency is null;
alter table public.offers alter column currency set not null;

-- Today, in a country's calendar.
drop function if exists public._offer_today();
create or replace function public._offer_today(p_country text)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone public._market_tz(p_country))::date;
$$;

revoke all on function public._offer_today(text) from public, anon, authenticated;

drop function if exists public.offer_setup();
create function public.offer_setup()
returns table (
  org_name text,
  org_slug text,
  logo_url text,
  cover_image_url text,
  city text,
  is_listed boolean,
  today date,
  timezone text,
  price_per_day numeric,
  currency text,
  slots_per_day int,
  max_days int,
  max_advance_days int,
  hold_minutes int,
  last_offer_day date
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;

  -- A country with no offer settings sells no offers: no row, and the
  -- page says offers are not available there yet.
  return query
    select o.name, o.slug, o.logo_url, o.cover_image_url, o.city, o.is_listed,
           public._offer_today(o.country), m.timezone, s.price_per_day, m.currency,
           s.slots_per_day, s.max_days, s.max_advance_days, s.hold_minutes,
           case
             when o.plan_expires_at is null then null
             else (public._plan_open_until(o.plan_expires_at) at time zone m.timezone)::date - 1
           end
    from public.organizations o
    join public.markets m on m.code = o.country
    join public.offer_settings s on s.country = o.country
    where o.id = v_org;
end;
$$;

drop function if exists public.offer_availability();
create function public.offer_availability()
returns table (day date, taken int, mine boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_city text;
  v_country text;
  v_today date;
  s public.offer_settings;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;

  select o.city, o.country into v_city, v_country from public.organizations o where o.id = v_org;
  -- No city, no places to count: the page asks for a city instead.
  if v_city is null then
    return;
  end if;

  select * into s from public.offer_settings where country = v_country;
  if not found then
    return;
  end if;
  v_today := public._offer_today(v_country);

  return query
    select d::date,
           public._offer_taken(v_city, d::date),
           exists (
             select 1 from public.offers f
             where f.org_id = v_org
               and d::date between f.start_date and f.end_date
               and public._offer_holds_place(f.status, f.hold_expires_at)
           )
    from generate_series(
      v_today::timestamp,
      (v_today + s.max_advance_days + s.max_days - 1)::timestamp,
      interval '1 day'
    ) d;
end;
$$;

revoke all on function public.offer_setup() from public, anon, authenticated;
grant execute on function public.offer_setup() to authenticated;
revoke all on function public.offer_availability() from public, anon, authenticated;
grant execute on function public.offer_availability() to authenticated;

-- 0046's body, with the country's settings, price and currency.
drop function if exists public.create_offer_order(text, uuid, date, int);
create function public.create_offer_order(
  p_title text,
  p_service_id uuid,
  p_start date,
  p_days int
)
returns table (offer_id uuid, total numeric, currency text, hold_expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_city text;
  v_country text;
  v_currency text;
  v_tz text;
  v_listed boolean;
  v_deleted timestamptz;
  v_plan_expires timestamptz;
  s public.offer_settings;
  v_today date;
  v_title text;
  v_end date;
  v_total numeric;
  v_hold timestamptz;
  v_id uuid;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;

  select o.city, o.country, m.currency, m.timezone, o.is_listed, o.deleted_at, o.plan_expires_at
    into v_city, v_country, v_currency, v_tz, v_listed, v_deleted, v_plan_expires
  from public.organizations o
  join public.markets m on m.code = o.country
  where o.id = v_org;

  if v_deleted is not null then
    raise exception 'not_authorized';
  end if;
  if v_city is null then
    raise exception 'offer_no_city';
  end if;
  -- An unlisted clinic's banner would never be shown (list_active_banners
  -- skips it), so it must not be sold one.
  if not v_listed then
    raise exception 'offer_not_listed';
  end if;
  -- 0046: a clinic past its plan and grace is closed to the public, so
  -- its banner could never be shown.
  if public._org_closed(null, v_plan_expires) then
    raise exception 'offer_plan_lapsed';
  end if;

  select * into s from public.offer_settings where country = v_country;
  if not found then
    raise exception 'offer_not_available';
  end if;

  v_title := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  if char_length(v_title) < 8 or char_length(v_title) > 70 then
    raise exception 'offer_title_length';
  end if;

  if p_service_id is not null and not exists (
    select 1 from public.services sv
    where sv.id = p_service_id and sv.org_id = v_org and sv.active
  ) then
    raise exception 'offer_bad_service';
  end if;

  v_today := public._offer_today(v_country);

  if p_start is null or p_start < v_today or p_start > v_today + s.max_advance_days then
    raise exception 'offer_bad_start';
  end if;
  if p_days is null or p_days < 1 or p_days > s.max_days then
    raise exception 'offer_bad_days';
  end if;
  v_end := p_start + p_days - 1;
  -- 0046: days after the plan (and its grace) end would be paid for and
  -- never shown. offer_setup().last_offer_day is the same boundary.
  if v_plan_expires is not null
     and v_end >= (public._plan_open_until(v_plan_expires) at time zone v_tz)::date then
    raise exception 'offer_beyond_plan';
  end if;

  -- One order at a time per city, so two clinics checking the last free
  -- place at the same moment cannot both see it free.
  perform pg_advisory_xact_lock(hashtext('offer_places:' || v_city));

  if exists (
    select 1 from public.offers f
    where f.org_id = v_org
      and f.start_date <= v_end and f.end_date >= p_start
      and public._offer_holds_place(f.status, f.hold_expires_at)
  ) then
    raise exception 'offer_org_overlap';
  end if;

  if exists (
    select 1
    from generate_series(p_start::timestamp, v_end::timestamp, interval '1 day') d
    where public._offer_taken(v_city, d::date) >= s.slots_per_day
  ) then
    raise exception 'offer_days_full';
  end if;

  v_total := round(s.price_per_day * p_days, public._currency_decimals(v_currency));
  v_hold := now() + make_interval(mins => s.hold_minutes);

  insert into public.offers (
    org_id, service_id, title, city, start_date, end_date,
    price_per_day, total, currency, hold_expires_at, created_by
  ) values (
    v_org, p_service_id, v_title, v_city, p_start, v_end,
    s.price_per_day, v_total, v_currency, v_hold, auth.uid()
  )
  returning id into v_id;

  return query select v_id, v_total, v_currency, v_hold;
end;
$$;

drop function if exists public.list_my_offers();
create function public.list_my_offers()
returns table (
  id uuid,
  title text,
  service_name text,
  city text,
  start_date date,
  end_date date,
  days int,
  price_per_day numeric,
  total numeric,
  currency text,
  state text,
  hold_expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.title, sv.name, f.city, f.start_date, f.end_date,
         (f.end_date - f.start_date + 1)::int,
         f.price_per_day, f.total, f.currency,
         case
           when f.status = 'pending_payment' and f.hold_expires_at > now() then 'awaiting_payment'
           when f.status = 'pending_payment' then 'expired'
           when f.status = 'paid' and public._offer_today(o.country) < f.start_date then 'scheduled'
           when f.status = 'paid' and public._offer_today(o.country) <= f.end_date then 'live'
           when f.status = 'paid' then 'ended'
           else f.status
         end,
         f.hold_expires_at, f.paid_at, f.created_at
  from public.offers f
  join public.organizations o on o.id = f.org_id
  left join public.services sv on sv.id = f.service_id
  where f.org_id = public._my_owner_org()
  order by f.created_at desc
  limit 100;
$$;

revoke all on function public.create_offer_order(text, uuid, date, int) from public, anon, authenticated;
grant execute on function public.create_offer_order(text, uuid, date, int) to authenticated;
revoke all on function public.list_my_offers() from public, anon, authenticated;
grant execute on function public.list_my_offers() to authenticated;

-- 0045's function with the amount named for what it is. Called by
-- confirm_payment by position, so its grant (nobody) and callers stand.
drop function if exists public.mark_offer_paid(uuid, numeric, text);
create function public.mark_offer_paid(
  p_offer_id uuid,
  p_amount numeric,
  p_payment_ref text
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  f public.offers;
  s public.offer_settings;
  v_country text;
  v_status text := 'paid';
begin
  select * into f from public.offers where id = p_offer_id for update;
  if not found then
    raise exception 'offer_not_found';
  end if;

  if f.status in ('paid', 'needs_refund') then
    return f.status;
  end if;

  if p_amount is null or p_amount <> f.total then
    raise exception 'offer_amount_mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtext('offer_places:' || f.city));
  select c.country into v_country from public.market_cities c where c.city = f.city;
  select * into s from public.offer_settings where country = v_country;

  if f.status <> 'pending_payment' then
    -- Cancelled or removed before the money arrived.
    v_status := 'needs_refund';
  elsif s.country is null then
    -- The country stopped selling offers after this order was placed.
    v_status := 'needs_refund';
  elsif f.hold_expires_at <= now() and (
    -- Paid after the hold lapsed: the places may have gone meanwhile.
    exists (
      select 1
      from generate_series(f.start_date::timestamp, f.end_date::timestamp, interval '1 day') d
      where public._offer_taken(f.city, d::date, f.id) >= s.slots_per_day
    )
    or exists (
      select 1 from public.offers o2
      where o2.org_id = f.org_id and o2.id <> f.id
        and o2.start_date <= f.end_date and o2.end_date >= f.start_date
        and public._offer_holds_place(o2.status, o2.hold_expires_at)
    )
  ) then
    v_status := 'needs_refund';
  elsif f.end_date < public._offer_today(v_country) then
    v_status := 'needs_refund';
  end if;

  update public.offers
     set status = v_status,
         paid_at = now(),
         payment_ref = p_payment_ref
   where id = f.id;

  return v_status;
end;
$$;

revoke all on function public.mark_offer_paid(uuid, numeric, text) from public, anon, authenticated;

drop function if exists public.start_offer_payment(uuid);
create function public.start_offer_payment(p_offer_id uuid)
returns table (payment_id uuid, amount numeric, currency text, country text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_total numeric;
  v_currency text;
  v_country text;
  v_id uuid;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;

  -- Only an order still inside its hold (0047). Its amount and currency
  -- are the order's own snapshot.
  select f.total, f.currency, o.country into v_total, v_currency, v_country
  from public.offers f
  join public.organizations o on o.id = f.org_id
  where f.id = p_offer_id
    and f.org_id = v_org
    and f.status = 'pending_payment'
    and f.hold_expires_at > now();

  if v_total is null then
    raise exception 'offer_not_payable';
  end if;

  insert into public.payments (org_id, kind, offer_id, amount, currency, country, created_by)
  values (v_org, 'offer', p_offer_id, v_total, v_currency, v_country, auth.uid())
  returning id into v_id;

  return query select v_id, v_total, v_currency, v_country;
end;
$$;

revoke all on function public.start_offer_payment(uuid) from public, anon, authenticated;
grant execute on function public.start_offer_payment(uuid) to authenticated;

-- The home page banner (0046), "today" in the city's own country.
create or replace function public.list_active_banners(p_city text)
returns table (
  offer_id uuid,
  title text,
  org_name text,
  org_slug text,
  logo_url text,
  cover_image_url text,
  service_id uuid,
  service_name text,
  service_photo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.title, o.name, o.slug, o.logo_url, o.cover_image_url,
         sv.id, sv.name, sv.photo_url
  from public.offers f
  join public.organizations o on o.id = f.org_id
  join public.market_cities c on c.city = f.city
  left join public.services sv
    on sv.id = f.service_id and sv.org_id = f.org_id and sv.active
  where f.status = 'paid'
    and f.city = p_city
    and public._offer_today(c.country) between f.start_date and f.end_date
    and o.is_listed
    and not public._org_closed(o.deleted_at, o.plan_expires_at)
    and public._market_listed(o.country)
  order by f.paid_at, f.id
  limit 20;
$$;


-- ---------------------------------------------------------------------
-- 6. What clinics and customers read, with the clinic's currency.
-- ---------------------------------------------------------------------

-- The dashboard bootstrap (0022), plus the clinic's country and currency.
-- Body unchanged otherwise.
drop function if exists public.get_my_context();
create function public.get_my_context()
returns table (
  org_id uuid,
  org_name text,
  org_slug text,
  org_address text,
  org_phone text,
  org_logo_url text,
  lang text,
  timezone text,
  business_hours jsonb,
  slot_interval_minutes int,
  min_notice_minutes int,
  max_advance_days int,
  wizard_done boolean,
  role text,
  deleted_at timestamptz,
  country text,
  currency text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
  v_email text;
  v_invite record;
  v_adopted int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select m.org_id, m.role into v_org_id, v_role
  from public.memberships m
  where m.user_id = auth.uid()
  limit 1;

  if v_org_id is null then
    select u.email into v_email from auth.users u where u.id = auth.uid();

    if v_email is not null then
      select * into v_invite
      from public.invitations
      where email = lower(v_email) and accepted_at is null
      order by created_at
      limit 1;

      if found then
        v_adopted := 0;

        -- If the invite was linked to a staff row created by name, claim
        -- THAT row rather than inserting a second one for the same person.
        if v_invite.membership_id is not null then
          update public.memberships
             set user_id = auth.uid(),
                 role = v_invite.role
           where id = v_invite.membership_id
             and org_id = v_invite.org_id   -- link must belong to the inviting org
             and user_id is null;           -- never take over a row that already has a login
          get diagnostics v_adopted = row_count;
        end if;

        -- Plain (unlinked) invite, or a linked row that was claimed or
        -- deleted between invite and acceptance. get_my_context is the
        -- app bootstrap, so this path must never fail the login.
        if v_adopted = 0 then
          insert into public.memberships (org_id, user_id, role)
          values (v_invite.org_id, auth.uid(), v_invite.role)
          on conflict (org_id, user_id) do nothing;
        end if;

        update public.invitations set accepted_at = now() where id = v_invite.id;

        v_org_id := v_invite.org_id;
        v_role := v_invite.role;
      end if;
    end if;
  end if;

  if v_org_id is null then
    return;
  end if;

  return query
    select
      o.id, o.name, o.slug, o.address, o.phone, o.logo_url,
      s.lang, s.timezone, s.business_hours, s.slot_interval_minutes,
      s.min_notice_minutes, s.max_advance_days, s.wizard_done,
      v_role, o.deleted_at, o.country, mk.currency
    from public.organizations o
    join public.org_settings s on s.org_id = o.id
    join public.markets mk on mk.code = o.country
    where o.id = v_org_id;
end;
$$;

revoke all on function public.get_my_context() from public, anon, authenticated;
grant execute on function public.get_my_context() to authenticated;

-- The booking page (0046), plus the currency its prices are in.
drop function if exists public.get_public_org(text);
create function public.get_public_org(p_slug text)
returns table (
  org_id uuid,
  name text,
  slug text,
  address text,
  phone text,
  logo_url text,
  timezone text,
  category text,
  city text,
  district text,
  description text,
  cover_image_url text,
  price_tier smallint,
  maps_url text,
  currency text
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.address, o.phone, o.logo_url, s.timezone,
         o.category, o.city, o.district, o.description, o.cover_image_url, o.price_tier,
         o.maps_url, mk.currency
  from public.organizations o
  join public.org_settings s on s.org_id = o.id
  join public.markets mk on mk.code = o.country
  where o.slug = p_slug and not public._org_closed(o.deleted_at, o.plan_expires_at);
$$;

revoke all on function public.get_public_org(text) from public, anon, authenticated;
grant execute on function public.get_public_org(text) to anon, authenticated;

-- Nearby (0046): plus the currency, and only countries shown to customers.
drop function if exists public.list_nearby_orgs(double precision, double precision, int);
create function public.list_nearby_orgs(
  p_lat double precision,
  p_lng double precision,
  p_limit int default 12
)
returns table (
  org_id uuid,
  name text,
  slug text,
  city text,
  district text,
  category text,
  logo_url text,
  cover_image_url text,
  price_tier smallint,
  avg_rating numeric,
  review_count int,
  distance_km numeric,
  currency text
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.city, o.district, o.category,
         o.logo_url, o.cover_image_url, o.price_tier,
         round(avg(r.rating)::numeric, 1), count(r.id)::int,
         -- least(1.0, …): the haversine argument is mathematically ≤ 1,
         -- but floating rounding can nudge it to 1.0000000000000002 for
         -- near-antipodal points — and asin of that is an ERROR, not a
         -- number. The caller's position comes from a client-writable
         -- cookie, so "nobody would ever be at the antipode of Jordan"
         -- is not a guarantee, it is an invitation.
         round((
           6371 * 2 * asin(least(1.0, sqrt(
             power(sin(radians((o.lat - p_lat) / 2)), 2)
             + cos(radians(p_lat)) * cos(radians(o.lat))
               * power(sin(radians((o.lng - p_lng) / 2)), 2)
           )))
         )::numeric, 2),
         mk.currency
  from public.organizations o
  join public.markets mk on mk.code = o.country
  left join public.reviews r on r.org_id = o.id and r.hidden_at is null
  where o.is_listed
    and mk.listed
    and not public._org_closed(o.deleted_at, o.plan_expires_at)
    and o.lat is not null
    -- a caller with garbage coordinates gets an empty list, not a
    -- distance sort measured from a place that does not exist
    and p_lat between -90 and 90
    and p_lng between -180 and 180
  group by o.id, mk.currency
  order by
    (6371 * 2 * asin(least(1.0, sqrt(
       power(sin(radians((o.lat - p_lat) / 2)), 2)
       + cos(radians(p_lat)) * cos(radians(o.lat))
         * power(sin(radians((o.lng - p_lng) / 2)), 2)
     )))) asc,
    avg(r.rating) desc nulls last,
    o.created_at desc
  limit greatest(1, least(p_limit, 60));
$$;

revoke all on function public.list_nearby_orgs(double precision, double precision, int) from public, anon, authenticated;
grant execute on function public.list_nearby_orgs(double precision, double precision, int) to anon, authenticated;

-- The directory (0046): plus the currency, only countries shown to
-- customers (a search with no city would otherwise reach a closed one),
-- and an optional country, so "all cities" means all cities of the
-- visitor's country rather than every country at once.
drop function if exists public.list_directory_orgs(text, text, text, int, int, text[], boolean, text, text, boolean);
drop function if exists public.list_directory_orgs(text, text, text, int, int, text[], boolean, text, text, boolean, text);
create function public.list_directory_orgs(
  p_city text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0,
  p_featured_categories text[] default null,
  p_featured_only boolean default false,
  p_order text default 'rating',
  p_district text default null,
  -- Pro plan featuring (0043): only orgs whose EFFECTIVE plan is featured.
  -- Sent by the home page featured row, never by search.
  p_plan_featured_only boolean default false,
  p_country text default null
)
returns table (
  org_id uuid,
  name text,
  slug text,
  city text,
  district text,
  category text,
  logo_url text,
  cover_image_url text,
  price_tier smallint,
  avg_rating numeric,
  review_count int,
  min_price numeric,
  currency text
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.city, o.district, o.category,
         o.logo_url, o.cover_image_url, o.price_tier,
         round(avg(r.rating)::numeric, 1), count(r.id)::int,
         (select min(sv.price) from public.services sv
           where sv.org_id = o.id and sv.active and sv.price > 0),
         mk.currency
  from public.organizations o
  join public.markets mk on mk.code = o.country
  left join public.reviews r on r.org_id = o.id and r.hidden_at is null
  where o.is_listed
    and mk.listed
    and not public._org_closed(o.deleted_at, o.plan_expires_at)
    and (p_city is null or o.city = p_city)
    and (p_country is null or o.country = p_country)
    and (p_district is null or o.district = p_district)
    and (not p_plan_featured_only or exists (
      select 1 from public.plans pl
      where pl.id = public.org_effective_plan(o.id) and pl.featured
    ))
    and (p_category is null or o.category = p_category)
    and (not p_featured_only or p_featured_categories is null or o.category = any(p_featured_categories))
    and (p_search is null or trim(p_search) = ''
         or o.name ilike '%' || trim(p_search) || '%'
         or o.district ilike '%' || trim(p_search) || '%')
  group by o.id, mk.currency
  order by
    case when p_order = 'newest' then o.created_at end desc nulls last,
    case when p_order <> 'newest' and p_featured_categories is not null
              and o.category = any(p_featured_categories) then 0 else 1 end,
    case when p_order <> 'newest' then avg(r.rating) end desc nulls last,
    o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;

revoke all on function public.list_directory_orgs(text, text, text, int, int, text[], boolean, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.list_directory_orgs(text, text, text, int, int, text[], boolean, text, text, boolean, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. Admin: every list and the overview take a country.
-- ---------------------------------------------------------------------

-- The admin calendar: a country's own, or Amman's for "all countries".
-- 0049's version read the single offer_settings row, which is gone.
create or replace function public._admin_tz()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public._market_tz('JO');
$$;

-- null = all countries; anything else must be a country that exists.
create or replace function public._admin_country(p_country text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text := nullif(upper(btrim(coalesce(p_country, ''))), '');
begin
  if v is not null and not exists (select 1 from public.markets m where m.code = v) then
    raise exception 'admin_bad_country';
  end if;
  return v;
end;
$$;

revoke all on function public._admin_tz() from public, anon, authenticated;
revoke all on function public._admin_country(text) from public, anon, authenticated;

-- 0050's overview with a country. Counts filtered to the country when one
-- is chosen, summed across countries otherwise (a clinic is a clinic).
-- Money is per country and currency always. Customers have no country, so
-- their counts are null (shown as "—") when a country is chosen.
drop function if exists public.admin_overview(date, date);
drop function if exists public.admin_overview(date, date, text);
create function public.admin_overview(p_from date, p_to date, p_country text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_country text;
  v_tz text;
  v_today date;
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
  v_country := public._admin_country(p_country);
  v_tz := case when v_country is null then public._admin_tz() else public._market_tz(v_country) end;
  v_today := (now() at time zone v_tz)::date;

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
  where o.slug not like 'demo-%'
    and (v_country is null or o.country = v_country);

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
                                  where m.active and o2.deleted_at is null and o2.slug not like 'demo-%'
                                    and (v_country is null or o2.country = v_country)))
    into v_subs
  from (
    select o.plan, o.is_trial, o.plan_expires_at, public._plan_phase(o.plan_expires_at) as phase
    from public.organizations o
    where o.deleted_at is null and o.slug not like 'demo-%'
      and (v_country is null or o.country = v_country)
  ) x;

  -- Per country and currency, never across (0048). 'paid' only, as in
  -- 0049: money that went back is not revenue.
  select coalesce(jsonb_agg(jsonb_build_object(
           'country', r.country,
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
    select p.country, p.currency,
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
      and (v_country is null or p.country = v_country)
    group by p.country, p.currency
  ) r;

  select coalesce(jsonb_agg(jsonb_build_object(
           'country', m.country, 'currency', m.currency,
           'amount', round(m.amount, 3), 'clinics', m.clinics)), '[]'::jsonb)
    into v_mrr
  from (
    select lp.country, lp.currency,
           sum(case when lp.period = 'year' then lp.amount / 12 else lp.amount end) as amount,
           count(*) as clinics
    from (
      select distinct on (p.org_id) p.org_id, p.country, p.currency, p.period, p.amount
      from public.payments p
      join public.organizations o on o.id = p.org_id
      where p.kind = 'plan' and p.status = 'paid' and p.plan_ends_at > now()
        and o.deleted_at is null and o.slug not like 'demo-%'
        and (v_country is null or p.country = v_country)
      order by p.org_id, p.paid_at desc
    ) lp
    group by lp.country, lp.currency
  ) m;

  select jsonb_build_object(
           'needs_refund',     (select count(*) from public.payments
                                 where status = 'needs_refund' and (v_country is null or country = v_country)),
           'failed',           (select count(*) from public.payments where status = 'failed'
                                   and created_at >= v_start and created_at < v_end
                                   and (v_country is null or country = v_country)),
           'renewal_failures', (select count(*) from public.billing_mandates bm
                                  join public.organizations o on o.id = bm.org_id
                                 where bm.failures > 0 and (v_country is null or o.country = v_country)))
    into v_attention;

  select jsonb_build_object(
           'live_today', count(*) filter (where f.status = 'paid'
                                            and public._offer_today(o.country) between f.start_date and f.end_date),
           'scheduled',  count(*) filter (where f.status = 'paid' and f.start_date > public._offer_today(o.country)),
           'removed',    count(*) filter (where f.status = 'removed'))
    into v_offers
  from public.offers f
  join public.organizations o on o.id = f.org_id
  where o.slug not like 'demo-%'
    and (v_country is null or o.country = v_country);

  select jsonb_build_object(
           'bookings',      count(*) filter (where a.created_at >= v_start and a.created_at < v_end),
           'bookings_prev', count(*) filter (where a.created_at >= v_prev_start and a.created_at < v_start),
           'upcoming',      count(*) filter (where a.status = 'booked' and a.start_at > now()),
           'cancelled',     count(*) filter (where a.status = 'cancelled' and a.created_at >= v_start and a.created_at < v_end),
           'no_show',       count(*) filter (where a.status = 'no_show' and a.created_at >= v_start and a.created_at < v_end))
    into v_activity
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  where o.slug not like 'demo-%'
    and (v_country is null or o.country = v_country);

  v_activity := v_activity || jsonb_build_object(
    'customers_total', case when v_country is null then (select count(*) from public.customers) end,
    'customers_new',   case when v_country is null then (select count(*) from public.customers
                                                           where created_at >= v_start and created_at < v_end) end,
    'reviews',         (select count(*) from public.reviews r join public.organizations o on o.id = r.org_id
                         where r.created_at >= v_start and r.created_at < v_end and o.slug not like 'demo-%'
                           and (v_country is null or o.country = v_country)),
    -- All reviews, not the period's: null when there are none, never 0 stars.
    'avg_rating',      (select round(avg(r.rating)::numeric, 2) from public.reviews r
                          join public.organizations o on o.id = r.org_id
                         where r.hidden_at is null and o.slug not like 'demo-%'
                           and (v_country is null or o.country = v_country)));

  with days as (
    select g::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ),
  b as (
    select (a.created_at at time zone v_tz)::date as day, count(*) as n
    from public.appointments a
    join public.organizations o on o.id = a.org_id
    where o.slug not like 'demo-%' and a.created_at >= v_start and a.created_at < v_end
      and (v_country is null or o.country = v_country)
    group by 1
  ),
  s as (
    select (o.created_at at time zone v_tz)::date as day, count(*) as n
    from public.organizations o
    where o.slug not like 'demo-%' and o.created_at >= v_start and o.created_at < v_end
      and (v_country is null or o.country = v_country)
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
        and (v_country is null or p.country = v_country)
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
    'country', v_country,
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

revoke all on function public.admin_overview(date, date, text) from public, anon, authenticated;
grant execute on function public.admin_overview(date, date, text) to authenticated;

drop function if exists public.admin_clinics();
drop function if exists public.admin_clinics(text);
create function public.admin_clinics(p_country text default null)
returns table (
  id uuid,
  name text,
  slug text,
  country text,
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
  card_label text,
  has_invoice boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_country text;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  v_country := public._admin_country(p_country);

  return query
    select o.id, o.name, o.slug, o.country, o.city, o.category, o.plan, o.is_trial, o.plan_expires_at,
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
           (select bm.card_label from public.billing_mandates bm where bm.org_id = o.id),
           exists (select 1 from public.payments p where p.org_id = o.id and p.invoice_no is not null)
    from public.organizations o
    where v_country is null or o.country = v_country
    order by o.created_at desc
    limit 1000;
end;
$$;

drop function if exists public.admin_payments(date, date);
drop function if exists public.admin_payments(date, date, text);
create function public.admin_payments(p_from date, p_to date, p_country text default null)
returns table (
  id uuid,
  created_at timestamptz,
  paid_at timestamptz,
  org_id uuid,
  org_name text,
  org_slug text,
  country text,
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
  v_country text;
  v_tz text;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if not public._admin_period_ok(p_from, p_to) then
    raise exception 'admin_bad_period';
  end if;
  v_country := public._admin_country(p_country);
  v_tz := case when v_country is null then public._admin_tz() else public._market_tz(v_country) end;

  return query
    select p.id, p.created_at, p.paid_at, p.org_id, coalesce(o.name, p.buyer_name, '—'), o.slug, p.country,
           p.kind, p.plan_id, p.period, coalesce(f.title, p.item_title), p.amount, p.currency,
           p.status, p.outcome, p.failure_reason, p.provider, p.provider_ref, p.is_renewal,
           p.refunded_at, p.refund_note, p.invoice_no, p.tax_amount
    from public.payments p
    left join public.organizations o on o.id = p.org_id
    left join public.offers f on f.id = p.offer_id
    where coalesce(p.paid_at, p.created_at) >= (p_from::timestamp at time zone v_tz)
      and coalesce(p.paid_at, p.created_at) < ((p_to + 1)::timestamp at time zone v_tz)
      and (v_country is null or p.country = v_country)
    order by p.created_at desc
    -- PostgREST returns at most 1000 rows; the page says when it hit that.
    limit 1000;
end;
$$;

drop function if exists public.admin_offers();
drop function if exists public.admin_offers(text);
create function public.admin_offers(p_country text default null)
returns table (
  id uuid,
  org_id uuid,
  org_name text,
  org_slug text,
  country text,
  title text,
  city text,
  start_date date,
  end_date date,
  total numeric,
  currency text,
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
declare
  v_country text;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  v_country := public._admin_country(p_country);

  return query
    select f.id, f.org_id, o.name, o.slug, o.country, f.title, f.city, f.start_date, f.end_date,
           f.total, f.currency, f.status, f.paid_at, f.removed_reason
    from public.offers f
    join public.organizations o on o.id = f.org_id
    where f.status in ('paid', 'removed', 'needs_refund')
      and (v_country is null or o.country = v_country)
    order by f.start_date desc
    limit 200;
end;
$$;

revoke all on function public.admin_clinics(text) from public, anon, authenticated;
grant execute on function public.admin_clinics(text) to authenticated;
revoke all on function public.admin_payments(date, date, text) from public, anon, authenticated;
grant execute on function public.admin_payments(date, date, text) to authenticated;
revoke all on function public.admin_offers(text) from public, anon, authenticated;
grant execute on function public.admin_offers(text) to authenticated;


-- ---------------------------------------------------------------------
-- 8. Tax registrations belong to a country.
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

  -- Sales with no invoice: paid before their country had an active
  -- registration. The page offers to invoice them; it never does it silently.
  select coalesce(jsonb_agg(jsonb_build_object('country', u.country, 'currency', u.currency,
                                               'count', u.n, 'amount', u.total)
         order by u.country, u.currency), '[]'::jsonb)
    into v_unassigned
  from (
    select p.country, p.currency, count(*) as n, sum(p.amount) as total
    from public.payments p
    left join public.organizations o on o.id = p.org_id
    where p.invoice_no is null
      and public._payment_is_sale(p.status, p.outcome)
      and (o.slug is null or o.slug not like 'demo-%')
    group by p.country, p.currency
  ) u;

  return jsonb_build_object('registrations', v_regs, 'unassigned', v_unassigned);
end;
$$;

-- 0050's function. The country must exist and the currency must be that
-- country's: a Saudi registration invoicing dinars would be wrong on
-- every line.
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
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
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
  if not exists (select 1 from public.markets m where m.code = v_country and m.currency = v_currency) then
    raise exception 'tax_country_currency';
  end if;

  if p_id is not null then
    select * into prev from public.tax_registrations where id = p_id for update;
    if not found then
      raise exception 'tax_not_found';
    end if;
    if exists (select 1 from public.payments p where p.tax_registration_id = p_id)
       and (prev.currency <> v_currency
            or prev.country <> v_country
            or prev.invoice_prefix <> upper(btrim(coalesce(p_invoice_prefix, '')))) then
      raise exception 'tax_locked_fields';
    end if;
  end if;

  begin
    if p_id is null then
      insert into public.tax_registrations
        (country, currency, legal_name, tax_number, address, tax_rate, timezone, invoice_prefix, active)
      values
        (v_country, v_currency, btrim(p_legal_name), btrim(p_tax_number),
         nullif(btrim(coalesce(p_address, '')), ''), p_tax_rate, p_timezone,
         upper(btrim(p_invoice_prefix)), coalesce(p_active, true))
      returning * into saved;
    else
      update public.tax_registrations
         set country = v_country,
             currency = v_currency,
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
      raise exception 'tax_country_taken';
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

-- Invoices the sales of one country that have none, oldest first.
drop function if exists public.admin_invoice_unassigned(text, text);
create function public.admin_invoice_unassigned(p_country text, p_reason text)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_country text := upper(btrim(coalesce(p_country, '')));
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
  if not exists (select 1 from public.tax_registrations t where t.active and t.country = v_country) then
    raise exception 'tax_no_registration';
  end if;

  for rec in
    select p.id
    from public.payments p
    left join public.organizations o on o.id = p.org_id
    where p.country = v_country
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
    jsonb_build_object('country', v_country, 'invoiced', v_count, 'reason', btrim(p_reason)));

  return v_count;
end;
$$;

-- 0050's report, with "sales that carry no invoice" counted for the
-- registration's country instead of its currency.
create or replace function public.admin_tax_report(p_registration_id uuid, p_from date, p_to date)
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

  -- Sales of this country and period that carry no invoice: named on the
  -- report, so a missing sale is visible rather than silently absent.
  select jsonb_build_object('count', count(*), 'amount', coalesce(sum(p.amount), 0))
    into v_unassigned
  from public.payments p
  left join public.organizations o on o.id = p.org_id
  where p.country = r.country
    and p.currency = r.currency
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

revoke all on function public.admin_tax_registrations() from public, anon, authenticated;
grant execute on function public.admin_tax_registrations() to authenticated;
revoke all on function public.admin_save_tax_registration(uuid, text, text, text, text, text, numeric, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_save_tax_registration(uuid, text, text, text, text, text, numeric, text, text, boolean, text) to authenticated;
revoke all on function public.admin_invoice_unassigned(text, text) from public, anon, authenticated;
grant execute on function public.admin_invoice_unassigned(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 9. Admin: countries, their prices, and moving a clinic.
-- ---------------------------------------------------------------------

-- Why a country cannot open for sign-up yet, or an empty array when it can.
create or replace function public._market_missing(p_country text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x.what order by x.ord), '[]'::jsonb)
  from (
    select 1 as ord, 'plan_prices' as what
    where exists (
      select 1 from public.plans p
      where not exists (select 1 from public.plan_prices pp where pp.plan_id = p.id and pp.country = p_country))
    union all
    select 2, 'offer_settings'
    where not exists (select 1 from public.offer_settings s where s.country = p_country)
    union all
    select 3, 'tax_registration'
    where not exists (select 1 from public.tax_registrations t where t.country = p_country and t.active)
  ) x;
$$;

revoke all on function public._market_missing(text) from public, anon, authenticated;

drop function if exists public.admin_markets();
create function public.admin_markets()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', m.code,
             'name_ar', m.name_ar,
             'name_en', m.name_en,
             'currency', m.currency,
             'timezone', m.timezone,
             'dial_code', m.dial_code,
             'signup_open', m.signup_open,
             'listed', m.listed,
             'missing', public._market_missing(m.code),
             'clinics', (select count(*) from public.organizations o
                          where o.country = m.code and o.deleted_at is null and o.slug not like 'demo-%'),
             'prices', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'plan_id', p.id,
                                 'price_month', pp.price_month,
                                 'price_year', pp.price_year) order by p.sort), '[]'::jsonb)
                          from public.plans p
                          left join public.plan_prices pp on pp.plan_id = p.id and pp.country = m.code),
             'offer', (select jsonb_build_object(
                                'price_per_day', s.price_per_day,
                                'slots_per_day', s.slots_per_day,
                                'max_days', s.max_days,
                                'max_advance_days', s.max_advance_days,
                                'hold_minutes', s.hold_minutes)
                         from public.offer_settings s where s.country = m.code),
             'tax_registration', (select jsonb_build_object('id', t.id, 'legal_name', t.legal_name,
                                                            'tax_number', t.tax_number, 'tax_rate', t.tax_rate)
                                    from public.tax_registrations t
                                   where t.country = m.code and t.active))
           order by m.sort, m.code), '[]'::jsonb)
    from public.markets m
  );
end;
$$;

-- Opening a country for sign-up needs everything a clinic there will
-- meet: a price for every plan, offer settings and an active tax
-- registration. The payment gateway's keys live in the server's
-- environment, which the database cannot see; the admin page checks those.
drop function if exists public.admin_save_market(text, boolean, boolean, text);
create function public.admin_save_market(p_code text, p_signup_open boolean, p_listed boolean, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  prev public.markets;
  v_missing jsonb;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'admin_reason_required';
  end if;
  if p_signup_open is null or p_listed is null then
    raise exception 'market_bad_input';
  end if;

  select * into prev from public.markets where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found then
    raise exception 'admin_bad_country';
  end if;

  if p_signup_open and not prev.signup_open then
    v_missing := public._market_missing(prev.code);
    if jsonb_array_length(v_missing) > 0 then
      raise exception 'market_not_ready';
    end if;
  end if;

  update public.markets
     set signup_open = p_signup_open, listed = p_listed, updated_at = now()
   where code = prev.code;

  perform public._admin_log('market_update', null, null, jsonb_build_object(
    'country', prev.code,
    'previous', jsonb_build_object('signup_open', prev.signup_open, 'listed', prev.listed),
    'saved', jsonb_build_object('signup_open', p_signup_open, 'listed', p_listed),
    'reason', btrim(p_reason)));
end;
$$;

-- Both prices null removes the plan from sale in that country, which an
-- open country refuses: its clinics would find nothing to buy.
drop function if exists public.admin_save_plan_price(text, text, numeric, numeric, text);
create function public.admin_save_plan_price(
  p_plan text,
  p_country text,
  p_price_month numeric,
  p_price_year numeric,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_country text := upper(btrim(coalesce(p_country, '')));
  prev public.plan_prices;
  v_open boolean;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'admin_reason_required';
  end if;
  select m.signup_open into v_open from public.markets m where m.code = v_country;
  if not found then
    raise exception 'admin_bad_country';
  end if;
  if not exists (select 1 from public.plans p where p.id = p_plan) then
    raise exception 'admin_bad_plan';
  end if;

  select * into prev from public.plan_prices where plan_id = p_plan and country = v_country for update;

  if p_price_month is null and p_price_year is null then
    if v_open then
      raise exception 'market_open_needs_prices';
    end if;
    delete from public.plan_prices where plan_id = p_plan and country = v_country;
  elsif p_price_month is null or p_price_year is null or p_price_month <= 0 or p_price_year <= 0 then
    raise exception 'price_bad_input';
  else
    insert into public.plan_prices (plan_id, country, price_month, price_year)
    values (p_plan, v_country, p_price_month, p_price_year)
    on conflict (plan_id, country) do update
      set price_month = excluded.price_month, price_year = excluded.price_year, updated_at = now();
  end if;

  perform public._admin_log('plan_price_update', null, null, jsonb_build_object(
    'country', v_country, 'plan', p_plan,
    'previous', case when prev.plan_id is null then null
                     else jsonb_build_object('price_month', prev.price_month, 'price_year', prev.price_year) end,
    'saved', case when p_price_month is null then null
                  else jsonb_build_object('price_month', p_price_month, 'price_year', p_price_year) end,
    'reason', btrim(p_reason)));
end;
$$;

-- A later change never reprices an order already placed (0045).
drop function if exists public.admin_save_offer_settings(text, numeric, int, int, int, int, text);
create function public.admin_save_offer_settings(
  p_country text,
  p_price_per_day numeric,
  p_slots_per_day int,
  p_max_days int,
  p_max_advance_days int,
  p_hold_minutes int,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_country text := upper(btrim(coalesce(p_country, '')));
  prev public.offer_settings;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'admin_reason_required';
  end if;
  if not exists (select 1 from public.markets m where m.code = v_country) then
    raise exception 'admin_bad_country';
  end if;

  select * into prev from public.offer_settings where country = v_country for update;

  begin
    insert into public.offer_settings
      (country, price_per_day, slots_per_day, max_days, max_advance_days, hold_minutes)
    values
      (v_country, p_price_per_day, p_slots_per_day, p_max_days, p_max_advance_days, p_hold_minutes)
    on conflict (country) do update
      set price_per_day = excluded.price_per_day,
          slots_per_day = excluded.slots_per_day,
          max_days = excluded.max_days,
          max_advance_days = excluded.max_advance_days,
          hold_minutes = excluded.hold_minutes,
          updated_at = now();
  exception
    when check_violation or not_null_violation then
      raise exception 'offer_settings_bad_input';
  end;

  perform public._admin_log('offer_settings_update', null, null, jsonb_build_object(
    'country', v_country,
    'previous', case when prev.country is null then null else to_jsonb(prev) end,
    'saved', jsonb_build_object('price_per_day', p_price_per_day, 'slots_per_day', p_slots_per_day,
                                'max_days', p_max_days, 'max_advance_days', p_max_advance_days,
                                'hold_minutes', p_hold_minutes),
    'reason', btrim(p_reason)));
end;
$$;

-- The one way a clinic changes country, invoiced or not. Its saved card
-- belongs to the old country's gateway account and currency, so automatic
-- renewal stops; the clinic pays again in its new country.
drop function if exists public.admin_move_org_country(uuid, text, text, text);
create function public.admin_move_org_country(p_org_id uuid, p_country text, p_city text, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  prev record;
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'admin_reason_required';
  end if;
  if not exists (select 1 from public.markets m where m.code = v_country) then
    raise exception 'admin_bad_country';
  end if;
  if v_city is not null and not exists (
    select 1 from public.market_cities c where c.city = v_city and c.country = v_country
  ) then
    raise exception 'org_city_country';
  end if;

  select o.country, o.city into prev from public.organizations o where o.id = p_org_id for update;
  if not found then
    raise exception 'admin_org_not_found';
  end if;
  if prev.country = v_country and prev.city is not distinct from v_city then
    return;
  end if;

  perform set_config('mawaid.country_move', 'on', true);
  update public.organizations set country = v_country, city = v_city where id = p_org_id;
  perform set_config('mawaid.country_move', 'off', true);

  if prev.country <> v_country then
    update public.billing_mandates set active = false, updated_at = now() where org_id = p_org_id;
  end if;

  perform public._admin_log('move_country', p_org_id, null, jsonb_build_object(
    'previous_country', prev.country, 'previous_city', prev.city,
    'country', v_country, 'city', v_city, 'reason', btrim(p_reason)));
end;
$$;

revoke all on function public.admin_markets() from public, anon, authenticated;
grant execute on function public.admin_markets() to authenticated;
revoke all on function public.admin_save_market(text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_save_market(text, boolean, boolean, text) to authenticated;
revoke all on function public.admin_save_plan_price(text, text, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.admin_save_plan_price(text, text, numeric, numeric, text) to authenticated;
revoke all on function public.admin_save_offer_settings(text, numeric, int, int, int, int, text) from public, anon, authenticated;
grant execute on function public.admin_save_offer_settings(text, numeric, int, int, int, int, text) to authenticated;
revoke all on function public.admin_move_org_country(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_move_org_country(uuid, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------
-- 1. Jordan open and listed, Saudi Arabia prepared and closed:
--      select code, currency, signup_open, listed from public.markets order by sort;
-- 2. Jordan's plan prices are the ones it had:
--      select plan_id, price_month, price_year from public.plan_prices where country = 'JO';
-- 3. Offer settings became Jordan's row:
--      select country, price_per_day, slots_per_day from public.offer_settings;
-- 4. Every clinic and payment has a country:
--      select count(*) from public.organizations where country is null;   -- 0
--      select count(*) from public.payments where country is null;        -- 0
-- 5. Every clinic's city belongs to its country (a row here is a clinic
--    whose city the admin page should fix):
--      select o.slug, o.city from public.organizations o
--      where o.city is not null
--        and not exists (select 1 from public.market_cities c where c.city = o.city and c.country = o.country);
select m.code, m.currency, m.signup_open, m.listed,
       (select count(*) from public.plan_prices pp where pp.country = m.code) as plan_prices,
       (select count(*) from public.offer_settings s where s.country = m.code) as offer_settings,
       (select count(*) from public.organizations o where o.country = m.code) as clinics
from public.markets m
order by m.sort;
