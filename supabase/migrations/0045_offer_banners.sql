-- Paid offer banners. A clinic writes its own offer ("20% off skin
-- cleaning until the end of the month"), picks its days, pays, and the
-- offer runs at the top of the home page for visitors in its city.
--
-- Owner's decisions, 2026-09: 2 JOD a day; 5 places a day; top of the
-- home page; card payment; live as soon as it is paid, with no review
-- first (the site owner takes a rule-breaking offer down afterwards).
--
-- Decided here, and why:
--   * Places are counted PER CITY. The home page is city-scoped, so an
--     Irbid clinic's offer is never shown to Amman visitors and must not
--     use up an Amman place either.
--   * One place per clinic per day. Otherwise one clinic could buy all
--     five places and the rotation would show nobody else.
--   * Placing an order HOLDS its days for hold_minutes while the clinic
--     pays, so two clinics cannot both pay for the last place. An expired
--     hold frees its places with no job to run: it just stops counting.
--   * Every number (price, places, limits) is one row in offer_settings,
--     so a price change is an UPDATE, not a redeploy.
--   * The offers table is readable and writable only through the
--     functions below; each one checks who is calling.
--
-- Not wired, and named so nobody mistakes it for done:
--   * the card gateway (not chosen yet). Until it is, mark_offer_paid() is
--     run by hand from the SQL editor to test the flow end to end.
--   * an owner page for taking offers down; remove_offer() from the SQL
--     editor until then.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Settings: one row, seeded with the owner's numbers.
-- ---------------------------------------------------------------------
create table if not exists public.offer_settings (
  id boolean primary key default true,
  price_per_day_jod numeric(7,2) not null default 2,
  slots_per_day int not null default 5,
  max_days int not null default 30,
  max_advance_days int not null default 60,
  hold_minutes int not null default 30,
  -- The day an offer runs is a calendar day here, whatever the server's
  -- clock says.
  timezone text not null default 'Asia/Amman',
  constraint offer_settings_single_row check (id),
  constraint offer_settings_price_positive check (price_per_day_jod > 0),
  constraint offer_settings_slots_positive check (slots_per_day >= 1),
  constraint offer_settings_days_positive check (max_days >= 1),
  constraint offer_settings_advance_nonneg check (max_advance_days >= 0),
  constraint offer_settings_hold_min check (hold_minutes >= 5)
);

alter table public.offer_settings enable row level security;
revoke all on public.offer_settings from anon, authenticated;

-- DO NOTHING: re-running this file must never undo a price changed by hand.
insert into public.offer_settings (id) values (true) on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 2. Orders. One row per purchase; its status is the payment's story and
--    "live / scheduled / ended" is derived from today, never stored.
-- ---------------------------------------------------------------------
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Same-org is checked by create_offer_order, the only insert path. A
  -- deleted service leaves the offer running, pointing at the clinic.
  service_id uuid references public.services(id) on delete set null,
  title text not null,
  -- The city the places were bought in, kept even if the clinic moves.
  city text not null,
  start_date date not null,
  end_date date not null,
  -- Snapshots: a later price change never reprices an existing order.
  price_per_day_jod numeric(7,2) not null,
  total_jod numeric(9,2) not null,
  status text not null default 'pending_payment',
  hold_expires_at timestamptz not null,
  paid_at timestamptz,
  payment_ref text,
  removed_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint offers_status check (status in
    ('pending_payment', 'paid', 'cancelled', 'removed', 'needs_refund')),
  constraint offers_dates check (end_date >= start_date),
  -- Mirrored as OFFER_TITLE_MIN / OFFER_TITLE_MAX in src/lib/offers.ts.
  constraint offers_title_len check (char_length(title) between 8 and 70),
  constraint offers_total_nonneg check (total_jod >= 0)
);

create index if not exists offers_city_dates_idx
  on public.offers (city, start_date, end_date)
  where status in ('paid', 'pending_payment');
create index if not exists offers_org_created_idx
  on public.offers (org_id, created_at desc);

alter table public.offers enable row level security;
revoke all on public.offers from anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Private helpers. Granted to nobody; the functions below run as
--    their owner and call them.
-- ---------------------------------------------------------------------
drop function if exists public._offer_today();
create function public._offer_today()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone s.timezone)::date
  from public.offer_settings s
  where s.id;
$$;

-- Whether an order occupies its places right now: paid, or placed and
-- still inside its payment hold.
drop function if exists public._offer_holds_place(text, timestamptz);
create function public._offer_holds_place(p_status text, p_hold_expires_at timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_status = 'paid'
      or (p_status = 'pending_payment' and p_hold_expires_at > now());
$$;

drop function if exists public._offer_taken(text, date, uuid);
create function public._offer_taken(p_city text, p_day date, p_exclude uuid default null)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.offers f
  where f.city = p_city
    and p_day between f.start_date and f.end_date
    and (p_exclude is null or f.id <> p_exclude)
    and public._offer_holds_place(f.status, f.hold_expires_at);
$$;

-- Offers are the owner's business, like plans (0043): staff cannot buy.
drop function if exists public._my_owner_org();
create function public._my_owner_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.org_id
  from public.memberships m
  where m.user_id = auth.uid() and m.role = 'owner'
  limit 1;
$$;

revoke all on function public._offer_today() from public, anon, authenticated;
revoke all on function public._offer_holds_place(text, timestamptz) from public, anon, authenticated;
revoke all on function public._offer_taken(text, date, uuid) from public, anon, authenticated;
revoke all on function public._my_owner_org() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. What the dashboard needs before an order: the numbers, and which
--    days still have room.
-- ---------------------------------------------------------------------
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
  price_per_day_jod numeric,
  slots_per_day int,
  max_days int,
  max_advance_days int,
  hold_minutes int
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

  return query
    select o.name, o.slug, o.logo_url, o.cover_image_url, o.city, o.is_listed,
           public._offer_today(), s.timezone, s.price_per_day_jod,
           s.slots_per_day, s.max_days, s.max_advance_days, s.hold_minutes
    from public.organizations o
    cross join public.offer_settings s
    where o.id = v_org and s.id;
end;
$$;

-- Every day an order could touch: today through the last day of the
-- longest order starting on the furthest allowed day. `mine` marks days
-- this clinic already occupies (one place per clinic per day).
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
  v_today date;
  s public.offer_settings;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;

  select o.city into v_city from public.organizations o where o.id = v_org;
  -- No city, no places to count: the page asks for a city instead.
  if v_city is null then
    return;
  end if;

  select * into s from public.offer_settings where id;
  v_today := public._offer_today();

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


-- ---------------------------------------------------------------------
-- 5. Placing and cancelling an order.
-- ---------------------------------------------------------------------
drop function if exists public.create_offer_order(text, uuid, date, int);
create function public.create_offer_order(
  p_title text,
  p_service_id uuid,
  p_start date,
  p_days int
)
returns table (offer_id uuid, total_jod numeric, hold_expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_city text;
  v_listed boolean;
  v_deleted timestamptz;
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

  select o.city, o.is_listed, o.deleted_at
    into v_city, v_listed, v_deleted
  from public.organizations o
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

  select * into s from public.offer_settings where id;
  v_today := public._offer_today();

  if p_start is null or p_start < v_today or p_start > v_today + s.max_advance_days then
    raise exception 'offer_bad_start';
  end if;
  if p_days is null or p_days < 1 or p_days > s.max_days then
    raise exception 'offer_bad_days';
  end if;
  v_end := p_start + p_days - 1;

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

  v_total := round(s.price_per_day_jod * p_days, 2);
  v_hold := now() + make_interval(mins => s.hold_minutes);

  insert into public.offers (
    org_id, service_id, title, city, start_date, end_date,
    price_per_day_jod, total_jod, hold_expires_at, created_by
  ) values (
    v_org, p_service_id, v_title, v_city, p_start, v_end,
    s.price_per_day_jod, v_total, v_hold, auth.uid()
  )
  returning id into v_id;

  return query select v_id, v_total, v_hold;
end;
$$;

-- Only before payment. Once paid, an offer runs its days; a refund is a
-- conversation with the site owner, not a button.
drop function if exists public.cancel_my_offer(uuid);
create function public.cancel_my_offer(p_offer_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;

  update public.offers f
     set status = 'cancelled'
   where f.id = p_offer_id
     and f.org_id = v_org
     and f.status = 'pending_payment';

  if not found then
    raise exception 'offer_not_cancellable';
  end if;
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
  price_per_day_jod numeric,
  total_jod numeric,
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
         f.price_per_day_jod, f.total_jod,
         case
           when f.status = 'pending_payment' and f.hold_expires_at > now() then 'awaiting_payment'
           when f.status = 'pending_payment' then 'expired'
           when f.status = 'paid' and public._offer_today() < f.start_date then 'scheduled'
           when f.status = 'paid' and public._offer_today() <= f.end_date then 'live'
           when f.status = 'paid' then 'ended'
           else f.status
         end,
         f.hold_expires_at, f.paid_at, f.created_at
  from public.offers f
  left join public.services sv on sv.id = f.service_id
  where f.org_id = public._my_owner_org()
  order by f.created_at desc
  limit 100;
$$;

revoke all on function public.create_offer_order(text, uuid, date, int) from public, anon, authenticated;
grant execute on function public.create_offer_order(text, uuid, date, int) to authenticated;
revoke all on function public.cancel_my_offer(uuid) from public, anon, authenticated;
grant execute on function public.cancel_my_offer(uuid) to authenticated;
revoke all on function public.list_my_offers() from public, anon, authenticated;
grant execute on function public.list_my_offers() to authenticated;


-- ---------------------------------------------------------------------
-- 6. Payment. Granted to NOBODY: the gateway's webhook will call it with
--    the service-role key; until then it is run by hand to test.
--
--    Safe to call twice — gateways retry webhooks — and it never takes a
--    place that is no longer free. Money that arrives for an order that
--    can no longer run becomes 'needs_refund' instead of being dropped.
-- ---------------------------------------------------------------------
drop function if exists public.mark_offer_paid(uuid, numeric, text);
create function public.mark_offer_paid(
  p_offer_id uuid,
  p_amount_jod numeric,
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
  v_status text := 'paid';
begin
  select * into f from public.offers where id = p_offer_id for update;
  if not found then
    raise exception 'offer_not_found';
  end if;

  if f.status in ('paid', 'needs_refund') then
    return f.status;
  end if;

  if p_amount_jod is null or p_amount_jod <> f.total_jod then
    raise exception 'offer_amount_mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtext('offer_places:' || f.city));
  select * into s from public.offer_settings where id;

  if f.status <> 'pending_payment' then
    -- Cancelled or removed before the money arrived.
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
  elsif f.end_date < public._offer_today() then
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

-- Taking a rule-breaking offer down. Granted to nobody (SQL editor).
drop function if exists public.remove_offer(uuid, text);
create function public.remove_offer(p_offer_id uuid, p_reason text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.offers
     set status = 'removed', removed_reason = p_reason
   where id = p_offer_id and status = 'paid';

  if not found then
    raise exception 'offer_not_removable';
  end if;
  return 'removed';
end;
$$;

revoke all on function public.mark_offer_paid(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.remove_offer(uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. The home page banner: today's paid offers for one city.
--    An inactive linked service drops the link but keeps the offer.
-- ---------------------------------------------------------------------
drop function if exists public.list_active_banners(text);
create function public.list_active_banners(p_city text)
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
  left join public.services sv
    on sv.id = f.service_id and sv.org_id = f.org_id and sv.active
  where f.status = 'paid'
    and f.city = p_city
    and public._offer_today() between f.start_date and f.end_date
    and o.is_listed
    and o.deleted_at is null
  order by f.paid_at, f.id
  limit 20;
$$;

revoke all on function public.list_active_banners(text) from public, anon, authenticated;
grant execute on function public.list_active_banners(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------
select price_per_day_jod, slots_per_day, max_days, max_advance_days, hold_minutes, timezone
from public.offer_settings;

-- Testing the whole flow before a gateway exists: place an order from
-- /offers in the dashboard, then
--   select id, title, total_jod, status from public.offers order by created_at desc limit 5;
--   select public.mark_offer_paid('<id>', <total_jod>, 'manual-test');   -- 'paid'
-- The banner shows on the home page for that city within a minute.
--   select public.remove_offer('<id>', 'test');                           -- takes it down
