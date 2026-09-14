-- No free plan. Every clinic starts on a free trial of basic; when a plan
-- (trial or paid) ends there are grace days with a warning in the
-- dashboard, and then the clinic is closed to the public: it leaves the
-- directory, its page and booking stop, and its offers stop showing. The
-- dashboard and every record stay, and paying reopens it immediately.
--
-- Owner's decision, 2026-09: a single-doctor clinic with one service
-- would have stayed on free forever and paid nothing. Trial 30 days,
-- grace 3 days, both one row in plan_settings.
--
-- How "closed to the public" is enforced: 15 functions already refuse a
-- closed organization (deleted_at set). Each is re-issued in section 6
-- with that single check widened to _org_closed(deleted_at,
-- plan_expires_at), so a lapsed plan is refused exactly where a closed
-- clinic is, with the same error. The bodies were copied from their
-- latest migration by a script that changed only that check and counted
-- the change, rather than retyped. "create or replace" keeps their grants.
--
-- Deliberately NOT gated: cancelling an existing booking by its link, and
-- leaving a review. A customer keeps those whatever the clinic's plan.
-- Booking from the dashboard goes through book_appointment too, so it
-- stops as well once the grace days are over.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The numbers.
-- ---------------------------------------------------------------------
create table if not exists public.plan_settings (
  id boolean primary key default true,
  trial_days int not null default 30,
  grace_days int not null default 3,
  constraint plan_settings_single_row check (id),
  constraint plan_settings_trial_positive check (trial_days >= 1),
  constraint plan_settings_grace_nonneg check (grace_days >= 0)
);

alter table public.plan_settings enable row level security;
revoke all on public.plan_settings from anon, authenticated;

insert into public.plan_settings (id) values (true) on conflict (id) do nothing;

-- A trial is basic with an end date, marked so the dashboard can call it
-- a trial. set_org_plan() clears it when a plan is assigned by hand.
alter table public.organizations
  add column if not exists is_trial boolean not null default false;


-- ---------------------------------------------------------------------
-- 2. When a plan stops opening the clinic.
-- ---------------------------------------------------------------------

-- The instant the grace days run out. null = the plan has no end.
create or replace function public._plan_open_until(p_plan_expires_at timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select p_plan_expires_at + make_interval(days => s.grace_days)
  from public.plan_settings s
  where s.id;
$$;

-- Closed to the public: deleted, or past plan end plus grace.
create or replace function public._org_closed(p_deleted_at timestamptz, p_plan_expires_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_deleted_at is not null
      or (p_plan_expires_at is not null
          and now() >= public._plan_open_until(p_plan_expires_at));
$$;

revoke all on function public._plan_open_until(timestamptz) from public, anon, authenticated;
revoke all on function public._org_closed(timestamptz, timestamptz) from public, anon, authenticated;

-- The plan that applies: the stored one while the clinic is open (grace
-- included, it still works then), null once it has lapsed. It used to
-- answer 'free' for an expired plan; there is no free plan any more.
create or replace function public.org_effective_plan(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public._org_closed(null, o.plan_expires_at) then null else o.plan end
  from public.organizations o
  where o.id = p_org_id;
$$;


-- ---------------------------------------------------------------------
-- 3. New clinics start on the trial, whatever path creates them.
-- ---------------------------------------------------------------------
alter table public.organizations alter column plan set default 'basic';

create or replace function public._org_start_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.plan := 'basic';
  new.is_trial := true;
  new.plan_expires_at := now() + make_interval(
    days => (select s.trial_days from public.plan_settings s where s.id));
  return new;
end;
$$;

revoke all on function public._org_start_trial() from public, anon, authenticated;

drop trigger if exists org_start_trial on public.organizations;
create trigger org_start_trial
  before insert on public.organizations
  for each row execute function public._org_start_trial();

-- Every clinic on free today is test data (owner, 2026-09): each gets a
-- trial from now. Then the free plan goes.
update public.organizations
   set plan = 'basic',
       is_trial = true,
       plan_expires_at = now() + make_interval(
         days => (select s.trial_days from public.plan_settings s where s.id))
 where plan = 'free';

delete from public.plans where id = 'free';


-- ---------------------------------------------------------------------
-- 4. Staff limits: a lapsed clinic adds nobody. 0043's body, except that
--    a lapsed plan used to resolve to 'free' and would now resolve to no
--    plan, which the old code read as "unlimited".
-- ---------------------------------------------------------------------
create or replace function public._enforce_plan_seats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_max int;
begin
  -- Exemptions and their reasons: 0043 section 4.
  if tg_table_name = 'memberships' then
    if new.user_id is not null and new.user_id = auth.uid() then
      return new;
    end if;
  elsif tg_table_name = 'invitations' then
    if new.membership_id is not null or exists (
      select 1 from public.invitations i
      where i.org_id = new.org_id and i.email = new.email
    ) then
      return new;
    end if;
  end if;

  perform 1 from public.organizations where id = new.org_id for update;
  if not found then
    -- The foreign key on org_id refuses this row on its own.
    return new;
  end if;

  v_plan := public.org_effective_plan(new.org_id);
  if v_plan is null then
    raise exception 'plan_lapsed';
  end if;

  select p.max_staff into v_max from public.plans p where p.id = v_plan;

  if v_max is not null and public._org_seats_used(new.org_id) >= v_max then
    raise exception 'plan_staff_limit';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. What the app reads.
-- ---------------------------------------------------------------------

-- Assigning a plan by hand ends a trial.
create or replace function public.set_org_plan(
  p_org_slug text,
  p_plan text,
  p_expires_at timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.plans where id = p_plan) then
    raise exception 'unknown_plan: %', p_plan;
  end if;

  update public.organizations
     set plan = p_plan,
         plan_expires_at = p_expires_at,
         is_trial = false
   where slug = p_org_slug and deleted_at is null
  returning id into v_id;

  if v_id is null then
    raise exception 'org_not_found: %', p_org_slug;
  end if;

  return p_org_slug || ' -> ' || p_plan
         || coalesce(' until ' || p_expires_at::text, ' (no expiry)');
end;
$$;

revoke all on function public.set_org_plan(text, text, timestamptz) from public, anon, authenticated;

-- Public: trial and grace length, for the pricing page's promise.
drop function if exists public.get_plan_terms();
create function public.get_plan_terms()
returns table (trial_days int, grace_days int)
language sql
stable
security definer
set search_path = public
as $$
  select s.trial_days, s.grace_days from public.plan_settings s where s.id;
$$;

revoke all on function public.get_plan_terms() from public, anon, authenticated;
grant execute on function public.get_plan_terms() to anon, authenticated;

-- Any member: their clinic's plan, where it stands, and seat usage.
-- phase: active (inside the plan) / grace (ended, still open) / lapsed.
drop function if exists public.my_plan_usage();
create function public.my_plan_usage()
returns table (
  plan_id text,
  is_trial boolean,
  expires_at timestamptz,
  open_until timestamptz,
  phase text,
  seats_used int,
  max_staff int,
  sms_per_month int,
  featured boolean
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
  select m.org_id into v_org
  from public.memberships m
  where m.user_id = auth.uid()
  limit 1;

  if v_org is null then
    raise exception 'not_authorized';
  end if;

  return query
    select o.plan,
           o.is_trial,
           o.plan_expires_at,
           public._plan_open_until(o.plan_expires_at),
           case
             when o.plan_expires_at is null or now() < o.plan_expires_at then 'active'
             when not public._org_closed(null, o.plan_expires_at) then 'grace'
             else 'lapsed'
           end,
           public._org_seats_used(v_org),
           p.max_staff,
           p.sms_per_month,
           p.featured
    from public.organizations o
    join public.plans p on p.id = o.plan
    where o.id = v_org;
end;
$$;

revoke all on function public.my_plan_usage() from public, anon, authenticated;
grant execute on function public.my_plan_usage() to authenticated;

-- Offers (0045): the dashboard learns the last day an offer may run.
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

  return query
    select o.name, o.slug, o.logo_url, o.cover_image_url, o.city, o.is_listed,
           public._offer_today(), s.timezone, s.price_per_day_jod,
           s.slots_per_day, s.max_days, s.max_advance_days, s.hold_minutes,
           case
             when o.plan_expires_at is null then null
             else (public._plan_open_until(o.plan_expires_at) at time zone s.timezone)::date - 1
           end
    from public.organizations o
    cross join public.offer_settings s
    where o.id = v_org and s.id;
end;
$$;

revoke all on function public.offer_setup() from public, anon, authenticated;
grant execute on function public.offer_setup() to authenticated;

-- create_offer_order: from 0045_offer_banners.sql
create or replace function public.create_offer_order(
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

  select o.city, o.is_listed, o.deleted_at, o.plan_expires_at
    into v_city, v_listed, v_deleted, v_plan_expires
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
  -- 0046: a clinic past its plan and grace is closed to the public, so
  -- its banner could never be shown.
  if public._org_closed(null, v_plan_expires) then
    raise exception 'offer_plan_lapsed';
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
  -- 0046: days after the plan (and its grace) end would be paid for and
  -- never shown. offer_setup().last_offer_day is the same boundary.
  if v_plan_expires is not null
     and v_end >= (public._plan_open_until(v_plan_expires) at time zone s.timezone)::date then
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


-- ---------------------------------------------------------------------
-- 6. Every public path refuses a lapsed clinic where it refuses a closed
--    one. Copied bodies; only the open-check changed.
-- ---------------------------------------------------------------------
-- count_open_now: from 0036_home_layout_data.sql
create or replace function public.count_open_now(p_city text default null)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int
  from public.organizations o
  join public.org_settings s on s.org_id = o.id
  where o.is_listed
    and not public._org_closed(o.deleted_at, o.plan_expires_at)
    and (p_city is null or o.city = p_city)
    and coalesce((
      select not coalesce((d.value ->> 'closed')::boolean, true)
         and (now() at time zone s.timezone)::time >= (d.value ->> 'open')::time
         and (now() at time zone s.timezone)::time <  (d.value ->> 'close')::time
      from jsonb_each(s.business_hours) d
      where d.key = extract(dow from now() at time zone s.timezone)::int::text
    ), false);
$$;

-- list_district_counts: from 0036_home_layout_data.sql
create or replace function public.list_district_counts(p_city text default null)
returns table (district text, org_count int)
language sql
security definer
stable
set search_path = public
as $$
  select o.district, count(*)::int
  from public.organizations o
  where o.is_listed
    and not public._org_closed(o.deleted_at, o.plan_expires_at)
    and o.district is not null
    and trim(o.district) <> ''
    and (p_city is null or o.city = p_city)
  group by o.district
  order by count(*) desc, o.district
  limit 12;
$$;

-- list_nearby_orgs: from 0031_nearby.sql
create or replace function public.list_nearby_orgs(
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
  distance_km numeric
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
         )::numeric, 2)
  from public.organizations o
  left join public.reviews r on r.org_id = o.id and r.hidden_at is null
  where o.is_listed
    and not public._org_closed(o.deleted_at, o.plan_expires_at)
    and o.lat is not null
    -- a caller with garbage coordinates gets an empty list, not a
    -- distance sort measured from a place that does not exist
    and p_lat between -90 and 90
    and p_lng between -180 and 180
  group by o.id
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

-- list_directory_orgs: from 0044_directory_plan_featuring.sql
create or replace function public.list_directory_orgs(
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
  p_plan_featured_only boolean default false
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
  min_price numeric
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
           where sv.org_id = o.id and sv.active and sv.price > 0)
  from public.organizations o
  left join public.reviews r on r.org_id = o.id and r.hidden_at is null
  where o.is_listed
    and not public._org_closed(o.deleted_at, o.plan_expires_at)
    and (p_city is null or o.city = p_city)
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
  group by o.id
  order by
    case when p_order = 'newest' then o.created_at end desc nulls last,
    case when p_order <> 'newest' and p_featured_categories is not null
              and o.category = any(p_featured_categories) then 0 else 1 end,
    case when p_order <> 'newest' then avg(r.rating) end desc nulls last,
    o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;

-- list_active_banners: from 0045_offer_banners.sql
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
  left join public.services sv
    on sv.id = f.service_id and sv.org_id = f.org_id and sv.active
  where f.status = 'paid'
    and f.city = p_city
    and public._offer_today() between f.start_date and f.end_date
    and o.is_listed
    and not public._org_closed(o.deleted_at, o.plan_expires_at)
  order by f.paid_at, f.id
  limit 20;
$$;

-- get_public_org: from 0016_org_maps_url.sql
create or replace function public.get_public_org(p_slug text)
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
  maps_url text
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.address, o.phone, o.logo_url, s.timezone,
         o.category, o.city, o.district, o.description, o.cover_image_url, o.price_tier,
         o.maps_url
  from public.organizations o
  join public.org_settings s on s.org_id = o.id
  where o.slug = p_slug and not public._org_closed(o.deleted_at, o.plan_expires_at);
$$;

-- list_public_services: from 0021_service_photos.sql
create or replace function public.list_public_services(p_org_slug text)
returns table (id uuid, name text, duration_minutes int, price numeric, photo_url text)
language sql
security definer
stable
set search_path = public
as $$
  select sv.id, sv.name, sv.duration_minutes, sv.price, sv.photo_url
  from public.services sv
  join public.organizations o on o.id = sv.org_id
  where o.slug = p_org_slug and not public._org_closed(o.deleted_at, o.plan_expires_at) and sv.active
  order by sv.sort_order, sv.created_at;
$$;

-- list_public_staff_for_service: from 0023_staff_title.sql
create or replace function public.list_public_staff_for_service(p_org_slug text, p_service_id uuid)
returns table (membership_id uuid, name text, title text)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.display_name, m.title
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where o.slug = p_org_slug and not public._org_closed(o.deleted_at, o.plan_expires_at)
    and nullif(trim(coalesce(m.display_name, '')), '') is not null
    and (
      not exists (select 1 from public.staff_services ss where ss.service_id = p_service_id)
      or exists (
        select 1 from public.staff_services ss
        where ss.service_id = p_service_id and ss.staff_membership_id = m.id
      )
    )
  order by m.display_name nulls last, m.created_at;
$$;

-- list_public_staff_for_services: from 0027_fix_0026.sql
create or replace function public.list_public_staff_for_services(
  p_org_slug text,
  p_service_ids uuid[]
)
returns table (membership_id uuid, name text, title text)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.display_name, m.title
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where o.slug = p_org_slug and not public._org_closed(o.deleted_at, o.plan_expires_at)
    and nullif(trim(coalesce(m.display_name, '')), '') is not null
    and not exists (
      select 1 from unnest(p_service_ids) sid
      where exists (select 1 from public.staff_services ss where ss.service_id = sid)
        and not exists (
          select 1 from public.staff_services ss
          where ss.service_id = sid and ss.staff_membership_id = m.id
        )
    )
  order by m.display_name nulls last, m.created_at;
$$;

-- get_org_reviews: from 0019_review_moderation.sql
create or replace function public.get_org_reviews(p_org_slug text, p_limit int default 10, p_offset int default 0)
returns table (rating smallint, comment text, customer_name text, created_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select r.rating, r.comment, r.customer_name, r.created_at
  from public.reviews r
  join public.organizations o on o.id = r.org_id
  where o.slug = p_org_slug and not public._org_closed(o.deleted_at, o.plan_expires_at) and r.hidden_at is null
  order by r.created_at desc
  limit greatest(1, least(p_limit, 50))
  offset greatest(0, p_offset);
$$;

-- get_org_rating_summary: from 0019_review_moderation.sql
create or replace function public.get_org_rating_summary(p_org_slug text)
returns table (avg_rating numeric, review_count int)
language sql
security definer
stable
set search_path = public
as $$
  select round(avg(r.rating)::numeric, 1), count(*)::int
  from public.reviews r
  join public.organizations o on o.id = r.org_id
  where o.slug = p_org_slug and not public._org_closed(o.deleted_at, o.plan_expires_at) and r.hidden_at is null;
$$;

-- get_available_slots_chain: from 0026_multi_service_and_customer_conflict.sql
create or replace function public.get_available_slots_chain(
  p_org_slug text,
  p_service_ids uuid[],
  p_date date,
  p_staff_id uuid default null
)
returns table (start_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_timezone text;
  v_org_hours jsonb;
  v_candidate timestamptz;
  v_cursor timestamptz;
  v_service_id uuid;
  v_duration int;
  v_buffer int;
  v_fits boolean;
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    return;
  end if;

  select o.id, s.timezone, s.business_hours
  into v_org_id, v_timezone, v_org_hours
  from public.organizations o
  join public.org_settings s on s.org_id = o.id
  where o.slug = p_org_slug and not public._org_closed(o.deleted_at, o.plan_expires_at);

  if v_org_id is null then
    return;
  end if;

  -- Candidates come from the FIRST service's normal slot list, so the
  -- chain still starts on the clinic's usual grid and inherits its
  -- min-notice and max-advance rules.
  for v_candidate in
    select g.start_at
    from public.get_available_slots(p_org_slug, p_service_ids[1], p_date, p_staff_id) g
  loop
    v_fits := true;
    v_cursor := v_candidate;

    foreach v_service_id in array p_service_ids loop
      select sv.duration_minutes, sv.buffer_minutes
      into v_duration, v_buffer
      from public.services sv
      where sv.id = v_service_id and sv.org_id = v_org_id and sv.active;

      if v_duration is null then
        v_fits := false;
        exit;
      end if;

      if public._staff_free_for(
           v_org_id, v_service_id, v_cursor,
           v_cursor + ((v_duration + v_buffer) || ' minutes')::interval,
           v_timezone, v_org_hours, p_staff_id
         ) is null then
        v_fits := false;
        exit;
      end if;

      v_cursor := v_cursor + ((v_duration + v_buffer) || ' minutes')::interval;
    end loop;

    if v_fits then
      start_at := v_candidate;
      return next;
    end if;
  end loop;
end;
$$;

-- get_available_slots: from 0013_staff_schedules.sql
create or replace function public.get_available_slots(
  p_org_slug text,
  p_service_id uuid,
  p_date date,
  p_staff_id uuid default null
)
returns table (start_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_org_deleted_at timestamptz;
  v_timezone text;
  v_org_hours jsonb;
  v_slot_interval_minutes int;
  v_min_notice_minutes int;
  v_max_advance_days int;
  v_service_id uuid;
  v_duration_minutes int;
  v_buffer_minutes int;
  v_staff_hours jsonb;
begin
  select o.id, case when public._org_closed(o.deleted_at, o.plan_expires_at) then coalesce(o.deleted_at, now()) end into v_org_id, v_org_deleted_at
  from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null or v_org_deleted_at is not null then
    return;
  end if;

  select s.timezone, s.business_hours, s.slot_interval_minutes, s.min_notice_minutes, s.max_advance_days
  into v_timezone, v_org_hours, v_slot_interval_minutes, v_min_notice_minutes, v_max_advance_days
  from public.org_settings s where s.org_id = v_org_id;
  if v_timezone is null then
    return;
  end if;

  select sv.id, sv.duration_minutes, sv.buffer_minutes into v_service_id, v_duration_minutes, v_buffer_minutes
  from public.services sv
  where sv.id = p_service_id and sv.org_id = v_org_id and sv.active;
  if v_service_id is null then
    return;
  end if;

  if p_staff_id is not null then
    select coalesce(m.business_hours, v_org_hours) into v_staff_hours
    from public.memberships m where m.id = p_staff_id and m.org_id = v_org_id;
    if v_staff_hours is null then
      return; -- staff not found in this org
    end if;
    if exists (select 1 from public.staff_services ss where ss.service_id = p_service_id)
       and not exists (
         select 1 from public.staff_services ss
         where ss.service_id = p_service_id and ss.staff_membership_id = p_staff_id
       )
    then
      return; -- this staff member doesn't perform this service
    end if;

    return query
      select * from public._resource_slots(
        v_timezone, v_staff_hours, v_slot_interval_minutes, v_min_notice_minutes, v_max_advance_days,
        v_duration_minutes, v_buffer_minutes, p_date, p_staff_id, p_staff_id
      );
    return;
  end if;

  -- "Any available staff": union every eligible staff member's slots.
  return query
    select distinct rs.start_at
    from public.memberships m
    cross join lateral public._resource_slots(
      v_timezone, coalesce(m.business_hours, v_org_hours), v_slot_interval_minutes, v_min_notice_minutes,
      v_max_advance_days, v_duration_minutes, v_buffer_minutes, p_date, m.id, m.id
    ) rs
    where m.org_id = v_org_id
      and (
        not exists (select 1 from public.staff_services ss where ss.service_id = p_service_id)
        or exists (select 1 from public.staff_services ss where ss.service_id = p_service_id and ss.staff_membership_id = m.id)
      )
    order by rs.start_at;
end;
$$;

-- book_appointment: from 0041_fair_staff_and_real_rate_limit.sql
create or replace function public.book_appointment(
  p_org_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_staff_id uuid default null,
  p_customer_email text default null,
  p_notes text default null,
  p_allow_overlap boolean default false
)
returns table (id uuid, cancel_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_org_deleted_at timestamptz;
  v_timezone text;
  v_org_hours jsonb;
  v_min_notice_minutes int;
  v_max_advance_days int;
  v_service_id uuid;
  v_duration_minutes int;
  v_buffer_minutes int;
  v_end_at timestamptz;
  v_local_date date;
  v_dow text;
  v_day jsonb;
  v_open time;
  v_close time;
  v_open_ts timestamptz;
  v_close_ts timestamptz;
  v_customer_user_id uuid;
  v_recent_count int;
  v_staff_hours jsonb;
  v_candidate record;
  v_norm_phone text;
  v_caller_is_staff boolean;
begin
  if trim(p_customer_name) = '' or trim(p_customer_phone) = '' then
    raise exception 'missing_contact_info';
  end if;

  v_norm_phone := public._norm_phone(p_customer_phone);

  -- Counts requests, not rows — see (e) above.
  select count(distinct a.created_at) into v_recent_count
  from public.appointments a
  where public._norm_phone(a.customer_phone) = v_norm_phone
    and v_norm_phone is not null
    -- Every request in the window counts, whatever became of the
    -- booking afterwards. Counting only status='booked' meant a
    -- book/cancel loop reset the allowance for ever on one number,
    -- and every one of those bookings had already fired a
    -- notification at the clinic (0029) — the real cost of the loop.
    and a.created_at > now() - interval '1 hour';
  if v_recent_count >= 6 then
    raise exception 'rate_limited';
  end if;

  select o.id, case when public._org_closed(o.deleted_at, o.plan_expires_at) then coalesce(o.deleted_at, now()) end into v_org_id, v_org_deleted_at
  from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null or v_org_deleted_at is not null then
    raise exception 'org_not_found';
  end if;

  select s.timezone, s.business_hours, s.min_notice_minutes, s.max_advance_days
  into v_timezone, v_org_hours, v_min_notice_minutes, v_max_advance_days
  from public.org_settings s where s.org_id = v_org_id;

  select sv.id, sv.duration_minutes, sv.buffer_minutes into v_service_id, v_duration_minutes, v_buffer_minutes
  from public.services sv
  where sv.id = p_service_id and sv.org_id = v_org_id and sv.active;
  if v_service_id is null then
    raise exception 'service_not_found';
  end if;

  v_end_at := p_start_at + ((v_duration_minutes + v_buffer_minutes) || ' minutes')::interval;
  v_local_date := (p_start_at at time zone v_timezone)::date;

  select c.user_id into v_customer_user_id
  from public.customers c where c.user_id = auth.uid();

  -- (d): on the dashboard the caller is the receptionist, not the patient.
  v_caller_is_staff := auth.uid() is not null and exists (
    select 1 from public.memberships m
    where m.org_id = v_org_id and m.user_id = auth.uid()
  );

  if p_staff_id is not null then
    -- Explicit staff chosen: validate + use their own hours/time-off.
    select coalesce(m.business_hours, v_org_hours) into v_staff_hours
    from public.memberships m where m.id = p_staff_id and m.org_id = v_org_id;
    if v_staff_hours is null then
      raise exception 'staff_not_found';
    end if;
    if exists (select 1 from public.staff_services ss where ss.service_id = p_service_id)
       and not exists (
         select 1 from public.staff_services ss
         where ss.service_id = p_service_id and ss.staff_membership_id = p_staff_id
       )
    then
      raise exception 'staff_not_assigned';
    end if;

    v_dow := extract(dow from v_local_date)::int::text;
    v_day := v_staff_hours -> v_dow;
    if v_day is null or (v_day ->> 'closed')::boolean then
      raise exception 'outside_business_hours';
    end if;
    v_open := (v_day ->> 'open')::time;
    v_close := (v_day ->> 'close')::time;
    v_open_ts := (v_local_date + v_open) at time zone v_timezone;
    v_close_ts := (v_local_date + v_close) at time zone v_timezone;
    if p_start_at < v_open_ts or v_end_at > v_close_ts then
      raise exception 'outside_business_hours';
    end if;
    if exists (
      select 1 from public.staff_time_off t
      where t.staff_membership_id = p_staff_id
        and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_start_at, v_end_at, '[)')
    ) then
      raise exception 'outside_business_hours';
    end if;
    if p_start_at < now() + (v_min_notice_minutes || ' minutes')::interval then
      raise exception 'too_soon';
    end if;
    if v_local_date > (now() at time zone v_timezone)::date + v_max_advance_days then
      raise exception 'too_far_ahead';
    end if;

    if not p_allow_overlap and public._customer_busy(
         v_norm_phone, p_start_at, v_end_at, v_caller_is_staff) then
      raise exception 'customer_time_conflict';
    end if;

    begin
      return query
        insert into public.appointments (
          org_id, service_id, staff_id, customer_name, customer_phone, customer_email,
          customer_user_id, start_at, end_at, notes
        )
        values (
          v_org_id, p_service_id, p_staff_id, trim(p_customer_name), trim(p_customer_phone),
          nullif(trim(coalesce(p_customer_email, '')), ''), v_customer_user_id,
          p_start_at, v_end_at, nullif(trim(coalesce(p_notes, '')), '')
        )
        returning appointments.id, appointments.cancel_token;
    exception
      when exclusion_violation then
        raise exception 'slot_taken';
    end;
    return;
  end if;

  -- "Any available staff": basic window checks against org hours first
  -- (cheap, catches the common invalid-time cases before touching staff).
  if p_start_at < now() + (v_min_notice_minutes || ' minutes')::interval then
    raise exception 'too_soon';
  end if;
  if v_local_date > (now() at time zone v_timezone)::date + v_max_advance_days then
    raise exception 'too_far_ahead';
  end if;

  if not p_allow_overlap and public._customer_busy(
       v_norm_phone, p_start_at, v_end_at, v_caller_is_staff) then
    raise exception 'customer_time_conflict';
  end if;

  -- Try each eligible staff member in turn; the exclusion constraint is
  -- the real race guard if two requests land on the same staff at once.
  for v_candidate in
    select m.id as membership_id, coalesce(m.business_hours, v_org_hours) as hours
    from public.memberships m
    where m.org_id = v_org_id
      and (
        not exists (select 1 from public.staff_services ss where ss.service_id = p_service_id)
        or exists (select 1 from public.staff_services ss where ss.service_id = p_service_id and ss.staff_membership_id = m.id)
      )
    -- Least loaded first, not oldest first. order by m.created_at
    -- always tried the same person — in practice the owner, the
    -- first membership an org gets — so every "any staff" booking
    -- landed on them while the rest of the roster sat empty
    -- (observed live: five spaced bookings, one column). Cancelled
    -- appointments are excluded here on purpose: they no longer
    -- occupy anyone's day, so they must not count as load.
    order by (
      select count(*)
      from public.appointments a
      where a.staff_id = m.id
        and a.status = 'booked'
        and (a.start_at at time zone v_timezone)::date = v_local_date
    ), m.created_at
  loop
    v_dow := extract(dow from v_local_date)::int::text;
    v_day := v_candidate.hours -> v_dow;
    if v_day is null or (v_day ->> 'closed')::boolean then
      continue;
    end if;
    v_open := (v_day ->> 'open')::time;
    v_close := (v_day ->> 'close')::time;
    v_open_ts := (v_local_date + v_open) at time zone v_timezone;
    v_close_ts := (v_local_date + v_close) at time zone v_timezone;
    if p_start_at < v_open_ts or v_end_at > v_close_ts then
      continue;
    end if;
    if exists (
      select 1 from public.staff_time_off t
      where t.staff_membership_id = v_candidate.membership_id
        and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_start_at, v_end_at, '[)')
    ) then
      continue;
    end if;

    begin
      insert into public.appointments (
        org_id, service_id, staff_id, customer_name, customer_phone, customer_email,
        customer_user_id, start_at, end_at, notes
      )
      values (
        v_org_id, p_service_id, v_candidate.membership_id, trim(p_customer_name), trim(p_customer_phone),
        nullif(trim(coalesce(p_customer_email, '')), ''), v_customer_user_id,
        p_start_at, v_end_at, nullif(trim(coalesce(p_notes, '')), '')
      )
      returning appointments.id, appointments.cancel_token into id, cancel_token;
      return next;
      return;
    exception
      when exclusion_violation then
        -- This staff member just got booked elsewhere — try the next one.
        continue;
    end;
  end loop;

  raise exception 'slot_taken';
end;
$$;

-- _reschedule: from 0030_reschedule.sql
create or replace function public._reschedule(
  p_appointment_id uuid,
  p_start_at timestamptz
)
returns table (id uuid, start_at timestamptz, end_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_timezone text;
  v_org_hours jsonb;
  v_min_notice int;
  v_max_advance int;
  v_duration int;
  v_buffer int;
  v_end_at timestamptz;
  v_local_date date;
  v_dow text;
  v_day jsonb;
  v_hours jsonb;
  v_open time;
  v_close time;
begin
  select ap.id, ap.org_id, ap.service_id, ap.staff_id, ap.status,
         ap.customer_name, ap.customer_phone, ap.start_at as old_start
  into a
  from public.appointments ap
  where ap.id = p_appointment_id;

  if a.id is null then
    raise exception 'booking_not_found';
  end if;
  if a.status <> 'booked' then
    -- A cancelled or completed appointment is history; moving it would
    -- silently resurrect it onto the calendar.
    raise exception 'booking_not_active';
  end if;

  if exists (select 1 from public.organizations o where o.id = a.org_id and public._org_closed(o.deleted_at, o.plan_expires_at)) then
    raise exception 'org_not_found';
  end if;

  select s.timezone, s.business_hours, s.min_notice_minutes, s.max_advance_days
  into v_timezone, v_org_hours, v_min_notice, v_max_advance
  from public.org_settings s where s.org_id = a.org_id;

  select sv.duration_minutes, sv.buffer_minutes into v_duration, v_buffer
  from public.services sv where sv.id = a.service_id;
  if v_duration is null then
    raise exception 'service_not_found';
  end if;

  v_end_at := p_start_at + ((v_duration + v_buffer) || ' minutes')::interval;
  v_local_date := (p_start_at at time zone v_timezone)::date;

  if p_start_at < now() + (v_min_notice || ' minutes')::interval then
    raise exception 'too_soon';
  end if;
  if v_local_date > (now() at time zone v_timezone)::date + v_max_advance then
    raise exception 'too_far_ahead';
  end if;

  -- The assigned specialist's own hours when there is one, the org's
  -- otherwise — the same rule book_appointment applies.
  if a.staff_id is not null then
    select coalesce(m.business_hours, v_org_hours) into v_hours
    from public.memberships m where m.id = a.staff_id;
  end if;
  v_hours := coalesce(v_hours, v_org_hours);

  v_dow := extract(dow from v_local_date)::int::text;
  v_day := v_hours -> v_dow;
  if v_day is null or (v_day ->> 'closed')::boolean then
    raise exception 'outside_business_hours';
  end if;
  v_open := (v_day ->> 'open')::time;
  v_close := (v_day ->> 'close')::time;
  -- Real instants, never ::time — see 0027 section 6(a).
  if p_start_at < (v_local_date + v_open) at time zone v_timezone
     or v_end_at > (v_local_date + v_close) at time zone v_timezone then
    raise exception 'outside_business_hours';
  end if;

  if a.staff_id is not null and exists (
    select 1 from public.staff_time_off t
    where t.staff_membership_id = a.staff_id
      and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_start_at, v_end_at, '[)')
  ) then
    raise exception 'outside_business_hours';
  end if;

  begin
    update public.appointments ap
    set start_at = p_start_at, end_at = v_end_at, updated_at = now()
    where ap.id = p_appointment_id;
  exception
    when exclusion_violation then
      raise exception 'slot_taken';
  end;

  -- The clinic is told, the same way it is told about a new booking.
  -- Wrapped for the same reason: a notification must never undo the move.
  begin
    insert into public.notifications (org_id, kind, title, body, appointment_id)
    values (
      a.org_id,
      'booking_rescheduled',
      a.customer_name,
      to_char(a.old_start at time zone coalesce(v_timezone, 'Asia/Amman'), 'YYYY-MM-DD HH24:MI')
        || ' → '
        || to_char(p_start_at at time zone coalesce(v_timezone, 'Asia/Amman'), 'YYYY-MM-DD HH24:MI')
        || ' · ' || a.customer_phone,
      a.id
    )
    -- The 0029 index is PARTIAL, so the conflict target has to repeat
    -- its predicate or PostgreSQL will not match it and the statement
    -- fails with "no unique or exclusion constraint matching".
    --
    -- do update, not do nothing: moving the same appointment twice must
    -- show the latest move, and must come back unread — a clinic that
    -- already dismissed the first notice would otherwise never learn
    -- about the second.
    on conflict (appointment_id, kind) where appointment_id is not null
    do update set body = excluded.body, created_at = now(), read_at = null;
  exception when others then
    null;
  end;

  return query
    select ap.id, ap.start_at, ap.end_at
    from public.appointments ap where ap.id = p_appointment_id;
end;
$$;


-- ---------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------
select trial_days, grace_days from public.plan_settings;
select id, price_month_jod from public.list_plans();                 -- basic, pro
select slug, plan, is_trial, plan_expires_at from public.organizations order by slug;

-- A lapsed clinic disappears (rolled back, nothing kept):
-- begin;
--   update public.organizations set plan_expires_at = now() - interval '4 days' where slug = 'moon';
--   select count(*) from public.list_directory_orgs() where slug = 'moon';   -- 0
--   select * from public.get_public_org('moon');                             -- no row
-- rollback;
