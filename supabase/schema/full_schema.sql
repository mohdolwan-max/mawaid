-- =====================================================================
-- COMPLETE SCHEMA for Maw3ed — every migration, in order, as one file.
--
-- Generated from supabase/migrations/. Use this ONLY to stand up a NEW,
-- EMPTY Supabase project. Never run it against the existing database:
-- several of these DROP and recreate functions, and 0026 drops a
-- signature that only exists before 0026 has run.
--
-- Order matters and is preserved exactly. Paste the whole file into the
-- new project's SQL editor and run it once.
--
-- 30 migrations: 0001_init.sql .. 0030_reschedule.sql
-- =====================================================================


-- #####################################################################
-- 0001_init.sql
-- #####################################################################

-- Mawaid (booking SaaS) — core multi-tenancy schema.
-- Tenant = "organization" = one clinic/beauty center.
--
-- Tables are all created first, then RLS policies — several policies
-- reference other tables (e.g. organizations' policy reads memberships),
-- and CREATE POLICY resolves those references immediately, so the
-- referenced table must already exist first.

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  address text,
  phone text,
  logo_url text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint slug_format check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')
);

-- org_settings: 1:1 with organizations — booking rules + business hours.
-- business_hours shape: {"0": {"open":"09:00","close":"21:00","closed":false}, ..., "6": {...}}
-- keyed by weekday index (0=Sunday..6=Saturday, see src/lib/date.ts#weekdayIndex).
create table public.org_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  lang text not null default 'ar' check (lang in ('ar', 'en')),
  timezone text not null default 'Asia/Riyadh',
  business_hours jsonb not null default '{
    "0": {"open":"09:00","close":"21:00","closed":false},
    "1": {"open":"09:00","close":"21:00","closed":false},
    "2": {"open":"09:00","close":"21:00","closed":false},
    "3": {"open":"09:00","close":"21:00","closed":false},
    "4": {"open":"09:00","close":"21:00","closed":false},
    "5": {"open":"09:00","close":"21:00","closed":true},
    "6": {"open":"09:00","close":"21:00","closed":false}
  }'::jsonb,
  slot_interval_minutes int not null default 15 check (slot_interval_minutes > 0),
  min_notice_minutes int not null default 60 check (min_notice_minutes >= 0),
  max_advance_days int not null default 30 check (max_advance_days > 0),
  wizard_done boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- Reserved so a clinic can't claim a slug that collides with an app route.
create table public.reserved_slugs (
  slug text primary key
);
insert into public.reserved_slugs (slug) values
  ('login'), ('signup'), ('auth'), ('api'), ('dashboard'), ('onboarding'),
  ('services'), ('staff'), ('bookings'), ('settings'), ('pricing'),
  ('security'), ('admin'), ('public'), ('static'), ('_next'), ('favicon.ico'),
  ('manifest.webmanifest'), ('robots.txt'), ('sitemap.xml');

-- Reference data read only from inside create_organization() (security
-- definer, bypasses RLS) — locked with RLS enabled and zero policies so no
-- anon/authenticated client can read or tamper with it directly.
alter table public.reserved_slugs enable row level security;

-- ---------------------------------------------------------------------
-- row level security
-- ---------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.org_settings enable row level security;
alter table public.memberships enable row level security;

-- security definer + stable so it can be used inside RLS policies without
-- re-evaluating per row and without the policy itself needing to embed the
-- membership subquery everywhere.
create function public.is_org_member(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = auth.uid()
  );
$$;

create function public.is_org_owner(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = auth.uid() and role = 'owner'
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.is_org_owner(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;

create policy "members can view their organization"
  on public.organizations for select
  using (public.is_org_member(id));

create policy "owner can update their organization"
  on public.organizations for update
  using (public.is_org_owner(id));

-- No insert/delete policy: rows are only created via create_organization()
-- (security definer below), which also creates the owner membership and
-- default settings row atomically. Direct inserts are denied by RLS.

create policy "members can view their settings"
  on public.org_settings for select
  using (public.is_org_member(org_id));

create policy "owner can update their settings"
  on public.org_settings for update
  using (public.is_org_owner(org_id));

create policy "users can view their own memberships"
  on public.memberships for select
  using (user_id = auth.uid());

create policy "members can view co-members"
  on public.memberships for select
  using (public.is_org_member(org_id));

-- ---------------------------------------------------------------------
-- create_organization(): atomically creates the org + owner membership +
-- default settings row for a brand-new signup. Runs as security definer
-- so it can bypass the (intentionally insert-less) RLS policy above.
-- ---------------------------------------------------------------------
create function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_slug text := lower(trim(p_slug));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if v_slug is null or v_slug = '' or v_slug !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' then
    raise exception 'invalid_slug';
  end if;

  if exists (select 1 from public.reserved_slugs where slug = v_slug) then
    raise exception 'slug_reserved';
  end if;

  insert into public.organizations (name, slug) values (nullif(trim(p_name), ''), v_slug)
  returning id into v_org_id;

  insert into public.memberships (org_id, user_id, role) values (v_org_id, auth.uid(), 'owner');

  insert into public.org_settings (org_id) values (v_org_id);

  return v_org_id;
exception
  when unique_violation then
    raise exception 'slug_taken';
end;
$$;

revoke all on function public.create_organization(text, text) from public;
grant execute on function public.create_organization(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- get_my_context(): the signed-in user's org + settings + role in one
-- round trip, instead of separate sequential lookups. If the user has no
-- membership yet, returns no row (the app sends them to /onboarding to
-- create one) — unlike Mahsoob, org creation here needs a name+slug from
-- the user first, so it isn't auto-created inside this RPC.
-- ---------------------------------------------------------------------
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
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select m.org_id, m.role into v_org_id, v_role
  from public.memberships m
  where m.user_id = auth.uid()
  limit 1;

  if v_org_id is null then
    return;
  end if;

  return query
    select
      o.id, o.name, o.slug, o.address, o.phone, o.logo_url,
      s.lang, s.timezone, s.business_hours, s.slot_interval_minutes,
      s.min_notice_minutes, s.max_advance_days, s.wizard_done,
      v_role, o.deleted_at
    from public.organizations o
    join public.org_settings s on s.org_id = o.id
    where o.id = v_org_id;
end;
$$;

revoke all on function public.get_my_context() from public;
grant execute on function public.get_my_context() to authenticated;


-- #####################################################################
-- 0002_services.sql
-- #####################################################################

-- Services offered by an organization (clinic/beauty center).

create table public.services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  duration_minutes int not null check (duration_minutes > 0),
  buffer_minutes int not null default 0 check (buffer_minutes >= 0),
  price numeric(10, 2),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index services_org_id_idx on public.services (org_id);

alter table public.services enable row level security;

create policy "members can view org services"
  on public.services for select
  using (public.is_org_member(org_id));

create policy "owner can manage org services"
  on public.services for all
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));


-- #####################################################################
-- 0003_staff.sql
-- #####################################################################

-- Staff accounts: invitations + optional staff-to-service assignment.
-- (memberships.role already allows 'staff' since 0001_init.sql.)

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email)
);

-- No rows for a service = any staff can perform it (see get_available_slots
-- in 0004_appointments.sql).
create table public.staff_services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  staff_membership_id uuid not null references public.memberships(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  unique (staff_membership_id, service_id)
);

create index staff_services_org_id_idx on public.staff_services (org_id);

alter table public.invitations enable row level security;
alter table public.staff_services enable row level security;

create policy "owner can manage invitations"
  on public.invitations for all
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));

create policy "members can view staff_services"
  on public.staff_services for select
  using (public.is_org_member(org_id));

create policy "owner can manage staff_services"
  on public.staff_services for all
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));

-- ---------------------------------------------------------------------
-- invite_staff(): owner-only, upserts a pending invitation by email.
-- ---------------------------------------------------------------------
create function public.invite_staff(p_org_id uuid, p_email text, p_role text default 'staff')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_org_owner(p_org_id) then
    raise exception 'not_authorized';
  end if;

  if p_role not in ('owner', 'staff') then
    raise exception 'invalid_role';
  end if;

  insert into public.invitations (org_id, email, role)
  values (p_org_id, lower(trim(p_email)), p_role)
  on conflict (org_id, email) do update set role = excluded.role, accepted_at = null
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.invite_staff(uuid, text, text) from public;
grant execute on function public.invite_staff(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- list_org_staff(): memberships (with email, joined from auth.users which
-- isn't otherwise exposed to PostgREST) unioned with still-pending
-- invitations, for the owner-only staff management page.
-- ---------------------------------------------------------------------
create function public.list_org_staff(p_org_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  role text,
  pending boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not_authorized';
  end if;

  return query
    select m.id, m.user_id, u.email, m.role, false
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
  union all
    select null::uuid, null::uuid, i.email, i.role, true
    from public.invitations i
    where i.org_id = p_org_id and i.accepted_at is null
  order by pending, email;
end;
$$;

revoke all on function public.list_org_staff(uuid) from public;
grant execute on function public.list_org_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_my_context(): extended with invite-acceptance. A brand-new user
-- with no membership yet, but a pending invitation matching their auth
-- email, is auto-joined to that org as the invited role instead of being
-- sent to /onboarding to create a new one.
-- ---------------------------------------------------------------------
create or replace function public.get_my_context()
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
  deleted_at timestamptz
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
        insert into public.memberships (org_id, user_id, role)
        values (v_invite.org_id, auth.uid(), v_invite.role)
        on conflict (org_id, user_id) do nothing;

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
      v_role, o.deleted_at
    from public.organizations o
    join public.org_settings s on s.org_id = o.id
    where o.id = v_org_id;
end;
$$;

revoke all on function public.get_my_context() from public;
grant execute on function public.get_my_context() to authenticated;


-- #####################################################################
-- 0004_appointments.sql
-- #####################################################################

-- Appointments + the availability engine.
--
-- Guest-first booking (see plan): no customer account required. Self-
-- service (view/cancel) is gated by an unguessable cancel_token, not auth.
-- This table therefore gets NO public/anon select policy at all — that
-- would leak other customers' names/phone numbers to anyone browsing a
-- clinic's public page. All public read/write access goes through the
-- narrow security-definer RPCs below.

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null references public.services(id),
  staff_id uuid references public.memberships(id),
  -- Deliberate v1 simplification: an unassigned ("any available staff")
  -- booking is checked against a single shared org-level resource, not
  -- against every individual staff member's calendar. A clinic that wants
  -- real per-staff capacity for "any available" bookings needs v2's
  -- per-staff scheduling; for now this just prevents double-booking the
  -- org's one shared slot when staff isn't configured yet.
  resource_id uuid generated always as (coalesce(staff_id, org_id)) stored,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  customer_user_id uuid references auth.users(id), -- reserved, unused in v1
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'completed', 'no_show')),
  cancel_token uuid not null default gen_random_uuid() unique,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint end_after_start check (end_at > start_at),
  -- The real concurrency guard: two overlapping 'booked' rows for the same
  -- resource can never both commit, even under simultaneous requests.
  -- Read-time filtering in get_available_slots() mirrors this so a slot
  -- offered to a customer is (almost always) still free by the time they
  -- submit — this constraint is what makes the rare race safe regardless.
  constraint no_overlap exclude using gist (
    resource_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status = 'booked')
);

create index appointments_org_start_idx on public.appointments (org_id, start_at);
create index appointments_staff_idx on public.appointments (staff_id);

alter table public.appointments enable row level security;

create policy "members can view org appointments"
  on public.appointments for select
  using (public.is_org_member(org_id));

create policy "owner can manage org appointments"
  on public.appointments for all
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));

create policy "staff can update their own appointments"
  on public.appointments for update
  using (
    staff_id in (select id from public.memberships m where m.user_id = auth.uid() and m.org_id = appointments.org_id)
  )
  with check (
    staff_id in (select id from public.memberships m where m.user_id = auth.uid() and m.org_id = appointments.org_id)
  );

-- =======================================================================
-- get_available_slots(): resolves org+service+business-hours+existing
-- bookings and returns bookable start times for one calendar day, in a
-- single round trip. Anonymous-callable (the public booking page has no
-- session). Never returns raw appointment rows — only start timestamps.
-- =======================================================================
create function public.get_available_slots(
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
  v_business_hours jsonb;
  v_slot_interval_minutes int;
  v_min_notice_minutes int;
  v_max_advance_days int;
  v_service_id uuid;
  v_duration_minutes int;
  v_buffer_minutes int;
  v_today date;
  v_dow text;
  v_day jsonb;
  v_open time;
  v_close time;
  v_day_start timestamp;
  v_day_end timestamp;
  v_step interval;
  v_slot_local timestamp;
  v_slot_utc timestamptz;
  v_resource_id uuid;
  v_slot_len interval;
begin
  select o.id, o.deleted_at into v_org_id, v_org_deleted_at
  from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null or v_org_deleted_at is not null then
    return;
  end if;

  select s.timezone, s.business_hours, s.slot_interval_minutes, s.min_notice_minutes, s.max_advance_days
  into v_timezone, v_business_hours, v_slot_interval_minutes, v_min_notice_minutes, v_max_advance_days
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
    if not exists (select 1 from public.memberships m where m.id = p_staff_id and m.org_id = v_org_id) then
      return;
    end if;
    if exists (select 1 from public.staff_services ss where ss.service_id = p_service_id)
       and not exists (
         select 1 from public.staff_services ss
         where ss.service_id = p_service_id and ss.staff_membership_id = p_staff_id
       )
    then
      return; -- this staff member doesn't perform this service
    end if;
  end if;

  v_today := (now() at time zone v_timezone)::date;
  if p_date < v_today or p_date > v_today + v_max_advance_days then
    return;
  end if;

  v_dow := extract(dow from p_date)::int::text;
  v_day := v_business_hours -> v_dow;
  if v_day is null or (v_day ->> 'closed')::boolean then
    return;
  end if;

  v_open := (v_day ->> 'open')::time;
  v_close := (v_day ->> 'close')::time;
  v_day_start := p_date::timestamp + v_open;
  v_day_end := p_date::timestamp + v_close;
  v_step := (v_slot_interval_minutes || ' minutes')::interval;
  v_slot_len := ((v_duration_minutes + v_buffer_minutes) || ' minutes')::interval;
  v_resource_id := coalesce(p_staff_id, v_org_id);

  v_slot_local := v_day_start;
  while v_slot_local + v_slot_len <= v_day_end loop
    v_slot_utc := v_slot_local at time zone v_timezone;

    if v_slot_utc >= now() + (v_min_notice_minutes || ' minutes')::interval then
      if not exists (
        select 1 from public.appointments a
        where a.resource_id = v_resource_id
          and a.status = 'booked'
          and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(v_slot_utc, v_slot_utc + v_slot_len, '[)')
      ) then
        start_at := v_slot_utc;
        return next;
      end if;
    end if;

    v_slot_local := v_slot_local + v_step;
  end loop;
end;
$$;

revoke all on function public.get_available_slots(text, uuid, date, uuid) from public;
grant execute on function public.get_available_slots(text, uuid, date, uuid) to anon, authenticated;

-- =======================================================================
-- book_appointment(): re-validates everything server-side (never trusts
-- the client's slot choice) and inserts. The EXCLUDE constraint above is
-- the actual race-condition guard — a unique_violation-style error here
-- just means "someone just took this slot."
-- =======================================================================
create function public.book_appointment(
  p_org_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_staff_id uuid default null,
  p_customer_email text default null,
  p_notes text default null
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
  v_business_hours jsonb;
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
begin
  if trim(p_customer_name) = '' or trim(p_customer_phone) = '' then
    raise exception 'missing_contact_info';
  end if;

  select o.id, o.deleted_at into v_org_id, v_org_deleted_at
  from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null or v_org_deleted_at is not null then
    raise exception 'org_not_found';
  end if;

  select s.timezone, s.business_hours, s.min_notice_minutes, s.max_advance_days
  into v_timezone, v_business_hours, v_min_notice_minutes, v_max_advance_days
  from public.org_settings s where s.org_id = v_org_id;

  select sv.id, sv.duration_minutes, sv.buffer_minutes into v_service_id, v_duration_minutes, v_buffer_minutes
  from public.services sv
  where sv.id = p_service_id and sv.org_id = v_org_id and sv.active;
  if v_service_id is null then
    raise exception 'service_not_found';
  end if;

  if p_staff_id is not null then
    if not exists (select 1 from public.memberships m where m.id = p_staff_id and m.org_id = v_org_id) then
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
  end if;

  v_end_at := p_start_at + ((v_duration_minutes + v_buffer_minutes) || ' minutes')::interval;
  v_local_date := (p_start_at at time zone v_timezone)::date;
  v_dow := extract(dow from v_local_date)::int::text;
  v_day := v_business_hours -> v_dow;

  if v_day is null or (v_day ->> 'closed')::boolean then
    raise exception 'outside_business_hours';
  end if;

  v_open := (v_day ->> 'open')::time;
  v_close := (v_day ->> 'close')::time;

  if (p_start_at at time zone v_timezone)::time < v_open
     or (v_end_at at time zone v_timezone)::time > v_close
  then
    raise exception 'outside_business_hours';
  end if;

  if p_start_at < now() + (v_min_notice_minutes || ' minutes')::interval then
    raise exception 'too_soon';
  end if;

  if v_local_date > (now() at time zone v_timezone)::date + v_max_advance_days then
    raise exception 'too_far_ahead';
  end if;

  begin
    return query
      insert into public.appointments (
        org_id, service_id, staff_id, customer_name, customer_phone, customer_email, start_at, end_at, notes
      )
      values (
        v_org_id, p_service_id, p_staff_id, trim(p_customer_name), trim(p_customer_phone),
        nullif(trim(coalesce(p_customer_email, '')), ''), p_start_at, v_end_at, nullif(trim(coalesce(p_notes, '')), '')
      )
      returning appointments.id, appointments.cancel_token;
  exception
    when exclusion_violation then
      raise exception 'slot_taken';
  end;
end;
$$;

revoke all on function public.book_appointment(text, uuid, timestamptz, text, text, uuid, text, text) from public;
grant execute on function public.book_appointment(text, uuid, timestamptz, text, text, uuid, text, text) to anon, authenticated;

-- =======================================================================
-- Guest self-service, token-gated (no session needed).
-- =======================================================================
create function public.get_booking_by_token(p_cancel_token uuid)
returns table (
  id uuid,
  org_name text,
  service_name text,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  customer_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, o.name, sv.name, a.start_at, a.end_at, a.status, a.customer_name
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  join public.services sv on sv.id = a.service_id
  where a.cancel_token = p_cancel_token;
$$;

revoke all on function public.get_booking_by_token(uuid) from public;
grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;

create function public.cancel_booking_by_token(p_cancel_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.appointments
  set status = 'cancelled', updated_at = now()
  where cancel_token = p_cancel_token and status = 'booked';

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.cancel_booking_by_token(uuid) from public;
grant execute on function public.cancel_booking_by_token(uuid) to anon, authenticated;


-- #####################################################################
-- 0005_public_booking.sql
-- #####################################################################

-- Public read access for the booking storefront (/[orgSlug]/*), anonymous.
--
-- organizations/services keep their existing member-only RLS policies —
-- rather than adding a second, broader "public can select" policy on those
-- tables (which would let anyone dump every tenant's full row with a plain
-- select), public access goes through narrow security-definer RPCs, same
-- principle as the appointments RPCs in 0004: return only the specific
-- columns/rows a stranger on a clinic's booking page actually needs.

create function public.get_public_org(p_slug text)
returns table (org_id uuid, name text, slug text, address text, phone text, logo_url text, timezone text)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.address, o.phone, o.logo_url, s.timezone
  from public.organizations o
  join public.org_settings s on s.org_id = o.id
  where o.slug = p_slug and o.deleted_at is null;
$$;

revoke all on function public.get_public_org(text) from public;
grant execute on function public.get_public_org(text) to anon, authenticated;

create function public.list_public_services(p_org_slug text)
returns table (id uuid, name text, duration_minutes int, price numeric)
language sql
security definer
stable
set search_path = public
as $$
  select sv.id, sv.name, sv.duration_minutes, sv.price
  from public.services sv
  join public.organizations o on o.id = sv.org_id
  where o.slug = p_org_slug and o.deleted_at is null and sv.active
  order by sv.sort_order, sv.created_at;
$$;

revoke all on function public.list_public_services(text) from public;
grant execute on function public.list_public_services(text) to anon, authenticated;

-- Staff selectable for a given service on the public booking page. Empty
-- staff_services rows for a service means any staff performs it, so in
-- that case this returns every staff member in the org.
create function public.list_public_staff_for_service(p_org_slug text, p_service_id uuid)
returns table (membership_id uuid, email text)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, u.email
  from public.memberships m
  join auth.users u on u.id = m.user_id
  join public.organizations o on o.id = m.org_id
  where o.slug = p_org_slug and o.deleted_at is null
    and (
      not exists (select 1 from public.staff_services ss where ss.service_id = p_service_id)
      or exists (
        select 1 from public.staff_services ss
        where ss.service_id = p_service_id and ss.staff_membership_id = m.id
      )
    )
  order by u.email;
$$;

revoke all on function public.list_public_staff_for_service(text, uuid) from public;
grant execute on function public.list_public_staff_for_service(text, uuid) to anon, authenticated;


-- #####################################################################
-- 0006_directory.sql
-- #####################################################################

-- Directory / marketplace foundation: public-profile columns on
-- organizations, the anon directory-browsing RPC, and the org-media
-- storage bucket. Orgs are UNLISTED by default (is_listed=false) — the
-- owner opts into the public directory from Settings.

alter table public.organizations
  add column category text,
  add column city text,
  add column district text,
  add column description text,
  add column cover_image_url text,
  add column price_tier smallint check (price_tier between 1 and 3),
  add column is_listed boolean not null default false;

create index organizations_directory_idx
  on public.organizations (city, category)
  where is_listed and deleted_at is null;

-- New app routes that must never be claimable as org slugs.
insert into public.reserved_slugs (slug) values
  ('search'), ('my'), ('account'), ('explore'), ('partners'), ('customer'),
  ('c'), ('reviews'), ('help'), ('about'), ('contact'), ('terms'),
  ('privacy'), ('app')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- get_public_org(): widened with the directory columns. Return-type
-- changes require drop + create (create or replace can't alter it).
-- ---------------------------------------------------------------------
drop function public.get_public_org(text);

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
  price_tier smallint
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.address, o.phone, o.logo_url, s.timezone,
         o.category, o.city, o.district, o.description, o.cover_image_url, o.price_tier
  from public.organizations o
  join public.org_settings s on s.org_id = o.id
  where o.slug = p_slug and o.deleted_at is null;
$$;

revoke all on function public.get_public_org(text) from public;
grant execute on function public.get_public_org(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- list_directory_orgs(): the marketplace browse/search RPC. avg_rating/
-- review_count are in the signature NOW (returning null/0) so the
-- reviews migration can later swap in real aggregates with a plain
-- `create or replace` — no signature change, no drop.
-- ---------------------------------------------------------------------
create function public.list_directory_orgs(
  p_city text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0
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
  review_count int
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.city, o.district, o.category,
         o.logo_url, o.cover_image_url, o.price_tier,
         null::numeric, 0
  from public.organizations o
  where o.is_listed
    and o.deleted_at is null
    and (p_city is null or o.city = p_city)
    and (p_category is null or o.category = p_category)
    and (p_search is null or trim(p_search) = ''
         or o.name ilike '%' || trim(p_search) || '%'
         or o.district ilike '%' || trim(p_search) || '%')
  order by o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;

revoke all on function public.list_directory_orgs(text, text, text, int, int) from public;
grant execute on function public.list_directory_orgs(text, text, text, int, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- org-media storage bucket: public read, owner-only writes under a
-- top-level folder named by the org id ({orgId}/cover-....jpg).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('org-media', 'org-media', true)
on conflict (id) do nothing;

create policy "public can view org media"
  on storage.objects for select
  using (bucket_id = 'org-media');

create policy "org owner can upload org media"
  on storage.objects for insert
  with check (
    bucket_id = 'org-media'
    and public.is_org_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "org owner can update org media"
  on storage.objects for update
  using (
    bucket_id = 'org-media'
    and public.is_org_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "org owner can delete org media"
  on storage.objects for delete
  using (
    bucket_id = 'org-media'
    and public.is_org_owner(((storage.foldername(name))[1])::uuid)
  );


-- #####################################################################
-- 0007_customers.sql
-- #####################################################################

-- Customer accounts. A "customer" is any auth user with a row here —
-- that row (not user_metadata) is the source of truth distinguishing
-- customers from org members. Same auth.users pool as org users;
-- get_my_context() is untouched.

create table public.customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customers enable row level security;

-- Own-row only; direct table access is fine here (unlike appointments,
-- nothing cross-customer is exposed).
create policy "customer can view own profile"
  on public.customers for select
  using (user_id = auth.uid());

create policy "customer can create own profile"
  on public.customers for insert
  with check (user_id = auth.uid());

create policy "customer can update own profile"
  on public.customers for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- list_my_bookings(): the signed-in customer's bookings across all orgs.
-- ---------------------------------------------------------------------
create function public.list_my_bookings()
returns table (
  id uuid,
  org_name text,
  org_slug text,
  service_name text,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  cancel_token uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, o.name, o.slug, sv.name, a.start_at, a.end_at, a.status, a.cancel_token
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  join public.services sv on sv.id = a.service_id
  where a.customer_user_id = auth.uid()
  order by a.start_at desc;
$$;

revoke all on function public.list_my_bookings() from public;
grant execute on function public.list_my_bookings() to authenticated;

-- ---------------------------------------------------------------------
-- book_appointment(): now links the booking to the caller when they are
-- a signed-in CUSTOMER (a customers row exists — this check keeps org
-- owners' test bookings on their own page from self-linking). Same
-- signature and return type, so create or replace is safe.
-- ---------------------------------------------------------------------
create or replace function public.book_appointment(
  p_org_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_staff_id uuid default null,
  p_customer_email text default null,
  p_notes text default null
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
  v_business_hours jsonb;
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
  v_customer_user_id uuid;
begin
  if trim(p_customer_name) = '' or trim(p_customer_phone) = '' then
    raise exception 'missing_contact_info';
  end if;

  select o.id, o.deleted_at into v_org_id, v_org_deleted_at
  from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null or v_org_deleted_at is not null then
    raise exception 'org_not_found';
  end if;

  select s.timezone, s.business_hours, s.min_notice_minutes, s.max_advance_days
  into v_timezone, v_business_hours, v_min_notice_minutes, v_max_advance_days
  from public.org_settings s where s.org_id = v_org_id;

  select sv.id, sv.duration_minutes, sv.buffer_minutes into v_service_id, v_duration_minutes, v_buffer_minutes
  from public.services sv
  where sv.id = p_service_id and sv.org_id = v_org_id and sv.active;
  if v_service_id is null then
    raise exception 'service_not_found';
  end if;

  if p_staff_id is not null then
    if not exists (select 1 from public.memberships m where m.id = p_staff_id and m.org_id = v_org_id) then
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
  end if;

  v_end_at := p_start_at + ((v_duration_minutes + v_buffer_minutes) || ' minutes')::interval;
  v_local_date := (p_start_at at time zone v_timezone)::date;
  v_dow := extract(dow from v_local_date)::int::text;
  v_day := v_business_hours -> v_dow;

  if v_day is null or (v_day ->> 'closed')::boolean then
    raise exception 'outside_business_hours';
  end if;

  v_open := (v_day ->> 'open')::time;
  v_close := (v_day ->> 'close')::time;

  if (p_start_at at time zone v_timezone)::time < v_open
     or (v_end_at at time zone v_timezone)::time > v_close
  then
    raise exception 'outside_business_hours';
  end if;

  if p_start_at < now() + (v_min_notice_minutes || ' minutes')::interval then
    raise exception 'too_soon';
  end if;

  if v_local_date > (now() at time zone v_timezone)::date + v_max_advance_days then
    raise exception 'too_far_ahead';
  end if;

  -- Link to the caller only when they are a registered customer.
  select c.user_id into v_customer_user_id
  from public.customers c where c.user_id = auth.uid();

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
end;
$$;


-- #####################################################################
-- 0008_reviews.sql
-- #####################################################################

-- Reviews & ratings. One review per appointment, only after the org
-- marked it completed. Submission is cancel_token-gated (same capability-
-- URL model as guest cancel), so it works identically for guests (email
-- link) and signed-in customers (/my reuses each row's token).

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  customer_name text not null,
  created_at timestamptz not null default now()
);

create index reviews_org_created_idx on public.reviews (org_id, created_at desc);

alter table public.reviews enable row level security;

-- Org members see their own org's reviews (dashboard); the public reads
-- only through the RPCs below.
create policy "members can view org reviews"
  on public.reviews for select
  using (public.is_org_member(org_id));

-- ---------------------------------------------------------------------
-- submit_review(): token-gated, completed appointments only, once each.
-- ---------------------------------------------------------------------
create function public.submit_review(
  p_cancel_token uuid,
  p_rating int,
  p_comment text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment_id uuid;
  v_org_id uuid;
  v_status text;
  v_customer_name text;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating';
  end if;

  select a.id, a.org_id, a.status, a.customer_name
  into v_appointment_id, v_org_id, v_status, v_customer_name
  from public.appointments a
  where a.cancel_token = p_cancel_token;

  if v_appointment_id is null then
    raise exception 'booking_not_found';
  end if;

  if v_status <> 'completed' then
    raise exception 'not_completed';
  end if;

  if exists (select 1 from public.reviews r where r.appointment_id = v_appointment_id) then
    raise exception 'already_reviewed';
  end if;

  insert into public.reviews (org_id, appointment_id, rating, comment, customer_name)
  values (v_org_id, v_appointment_id, p_rating, nullif(trim(coalesce(p_comment, '')), ''), v_customer_name);

  return true;
end;
$$;

revoke all on function public.submit_review(uuid, int, text) from public;
grant execute on function public.submit_review(uuid, int, text) to anon, authenticated;

create function public.can_review(p_cancel_token uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    where a.cancel_token = p_cancel_token
      and a.status = 'completed'
      and not exists (select 1 from public.reviews r where r.appointment_id = a.id)
  );
$$;

revoke all on function public.can_review(uuid) from public;
grant execute on function public.can_review(uuid) to anon, authenticated;

create function public.get_org_reviews(p_org_slug text, p_limit int default 10, p_offset int default 0)
returns table (rating smallint, comment text, customer_name text, created_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select r.rating, r.comment, r.customer_name, r.created_at
  from public.reviews r
  join public.organizations o on o.id = r.org_id
  where o.slug = p_org_slug and o.deleted_at is null
  order by r.created_at desc
  limit greatest(1, least(p_limit, 50))
  offset greatest(0, p_offset);
$$;

revoke all on function public.get_org_reviews(text, int, int) from public;
grant execute on function public.get_org_reviews(text, int, int) to anon, authenticated;

create function public.get_org_rating_summary(p_org_slug text)
returns table (avg_rating numeric, review_count int)
language sql
security definer
stable
set search_path = public
as $$
  select round(avg(r.rating)::numeric, 1), count(*)::int
  from public.reviews r
  join public.organizations o on o.id = r.org_id
  where o.slug = p_org_slug and o.deleted_at is null;
$$;

revoke all on function public.get_org_rating_summary(text) from public;
grant execute on function public.get_org_rating_summary(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- list_directory_orgs(): real rating aggregates now (same signature as
-- 0006, so plain create or replace). Rated orgs sort first.
-- ---------------------------------------------------------------------
create or replace function public.list_directory_orgs(
  p_city text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0
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
  review_count int
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.city, o.district, o.category,
         o.logo_url, o.cover_image_url, o.price_tier,
         round(avg(r.rating)::numeric, 1), count(r.id)::int
  from public.organizations o
  left join public.reviews r on r.org_id = o.id
  where o.is_listed
    and o.deleted_at is null
    and (p_city is null or o.city = p_city)
    and (p_category is null or o.category = p_category)
    and (p_search is null or trim(p_search) = ''
         or o.name ilike '%' || trim(p_search) || '%'
         or o.district ilike '%' || trim(p_search) || '%')
  group by o.id
  order by avg(r.rating) desc nulls last, o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;

-- ---------------------------------------------------------------------
-- list_my_bookings(): adds has_review (return-type change → drop first).
-- ---------------------------------------------------------------------
drop function public.list_my_bookings();

create function public.list_my_bookings()
returns table (
  id uuid,
  org_name text,
  org_slug text,
  service_name text,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  cancel_token uuid,
  has_review boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, o.name, o.slug, sv.name, a.start_at, a.end_at, a.status, a.cancel_token,
         exists (select 1 from public.reviews r where r.appointment_id = a.id)
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  join public.services sv on sv.id = a.service_id
  where a.customer_user_id = auth.uid()
  order by a.start_at desc;
$$;

revoke all on function public.list_my_bookings() from public;
grant execute on function public.list_my_bookings() to authenticated;


-- #####################################################################
-- 0009_reminders.sql
-- #####################################################################

-- Appointment reminders via Web Push, ~30 minutes before start.
--
-- Delivery pipeline: a pg_cron job (scheduled in a separate one-off SQL
-- snippet — it embeds the secret, and this file lives in a public repo)
-- POSTs every 5 minutes to /api/cron/reminders on Vercel, which calls
-- claim_due_reminders() below and sends the pushes. The secret lives in
-- app_config (RLS enabled, zero policies — unreadable by anon/authed).

alter table public.appointments add column reminder_sent_at timestamptz;

-- One row per browser/device push subscription. Linked to a customer
-- account and/or a specific appointment (guests subscribe per-booking
-- via its cancel_token).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid references auth.users(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  constraint linked_to_something check (customer_user_id is not null or appointment_id is not null)
);

create index push_subscriptions_customer_idx on public.push_subscriptions (customer_user_id);
create index push_subscriptions_appointment_idx on public.push_subscriptions (appointment_id);

alter table public.push_subscriptions enable row level security;
-- No policies: all access via the RPCs below.

create table public.app_config (
  key text primary key,
  value text not null
);

alter table public.app_config enable row level security;
-- No policies: only security-definer functions read this.

-- ---------------------------------------------------------------------
-- save_push_subscription(): called from the browser after the user
-- grants notification permission. Links to the caller's customer account
-- (when they have one) and/or to a booking via its unguessable
-- cancel_token — at least one link is required, so anonymous junk rows
-- can't accumulate.
-- ---------------------------------------------------------------------
create function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_cancel_token uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_user_id uuid;
  v_appointment_id uuid;
begin
  if p_endpoint is null or trim(p_endpoint) = '' then
    raise exception 'invalid_subscription';
  end if;

  select c.user_id into v_customer_user_id
  from public.customers c where c.user_id = auth.uid();

  if p_cancel_token is not null then
    select a.id into v_appointment_id
    from public.appointments a where a.cancel_token = p_cancel_token;
  end if;

  if v_customer_user_id is null and v_appointment_id is null then
    raise exception 'not_linkable';
  end if;

  insert into public.push_subscriptions (customer_user_id, appointment_id, endpoint, p256dh, auth)
  values (v_customer_user_id, v_appointment_id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth = excluded.auth,
        customer_user_id = coalesce(excluded.customer_user_id, push_subscriptions.customer_user_id),
        appointment_id = coalesce(excluded.appointment_id, push_subscriptions.appointment_id);

  return true;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, uuid) from public;
grant execute on function public.save_push_subscription(text, text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- claim_due_reminders(): atomically marks appointments starting within
-- the next 35 minutes as reminded and returns one row per (appointment ×
-- push subscription) plus the appointment fields the sender needs.
-- Secret-gated because it exposes customer contact data and marking
-- suppresses future sends.
-- ---------------------------------------------------------------------
create function public.claim_due_reminders(p_secret text)
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
begin
  if p_secret is distinct from (select value from public.app_config where key = 'cron_secret') then
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
      returning a.id, a.org_id, a.service_id, a.start_at, a.customer_name,
                a.customer_email, a.customer_user_id, a.cancel_token
    )
    select c.id, o.name, sv.name, c.start_at, s.timezone,
           c.customer_name, c.customer_email, o.slug, c.cancel_token,
           ps.endpoint, ps.p256dh, ps.auth
    from claimed c
    join public.organizations o on o.id = c.org_id
    join public.org_settings s on s.org_id = c.org_id
    join public.services sv on sv.id = c.service_id
    left join public.push_subscriptions ps
      on ps.appointment_id = c.id
      or (c.customer_user_id is not null and ps.customer_user_id = c.customer_user_id);
end;
$$;

revoke all on function public.claim_due_reminders(text) from public;
grant execute on function public.claim_due_reminders(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- delete_push_subscription(): the sender prunes dead endpoints (HTTP
-- 404/410 from the push service). Same secret gate.
-- ---------------------------------------------------------------------
create function public.delete_push_subscription(p_secret text, p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret is distinct from (select value from public.app_config where key = 'cron_secret') then
    raise exception 'not_authorized';
  end if;

  delete from public.push_subscriptions where endpoint = p_endpoint;
  return true;
end;
$$;

revoke all on function public.delete_push_subscription(text, text) from public;
grant execute on function public.delete_push_subscription(text, text) to anon, authenticated;


-- #####################################################################
-- 0010_security_hardening.sql
-- #####################################################################

-- Abuse-prevention layer for the public booking RPC. Same signature and
-- return type as the version in 0007_customers.sql, so `create or replace`
-- is safe (no drop needed).
--
-- Guards added:
--  1. Per-phone rate limit: a phone number that already has 6+ 'booked'
--     rows created in the last hour (platform-wide, not per-org) is
--     rejected — well above any real customer's normal usage, but shuts
--     down a bot flooding the calendar with junk bookings.
--  2. Defense in depth alongside the client-side honeypot field (see
--     BookingClient.tsx) — a bot that skips the browser entirely and
--     calls the RPC directly still hits this limit.

create or replace function public.book_appointment(
  p_org_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_staff_id uuid default null,
  p_customer_email text default null,
  p_notes text default null
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
  v_business_hours jsonb;
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
  v_customer_user_id uuid;
  v_recent_count int;
begin
  if trim(p_customer_name) = '' or trim(p_customer_phone) = '' then
    raise exception 'missing_contact_info';
  end if;

  select count(*) into v_recent_count
  from public.appointments a
  where a.customer_phone = trim(p_customer_phone)
    and a.status = 'booked'
    and a.created_at > now() - interval '1 hour';

  if v_recent_count >= 6 then
    raise exception 'rate_limited';
  end if;

  select o.id, o.deleted_at into v_org_id, v_org_deleted_at
  from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null or v_org_deleted_at is not null then
    raise exception 'org_not_found';
  end if;

  select s.timezone, s.business_hours, s.min_notice_minutes, s.max_advance_days
  into v_timezone, v_business_hours, v_min_notice_minutes, v_max_advance_days
  from public.org_settings s where s.org_id = v_org_id;

  select sv.id, sv.duration_minutes, sv.buffer_minutes into v_service_id, v_duration_minutes, v_buffer_minutes
  from public.services sv
  where sv.id = p_service_id and sv.org_id = v_org_id and sv.active;
  if v_service_id is null then
    raise exception 'service_not_found';
  end if;

  if p_staff_id is not null then
    if not exists (select 1 from public.memberships m where m.id = p_staff_id and m.org_id = v_org_id) then
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
  end if;

  v_end_at := p_start_at + ((v_duration_minutes + v_buffer_minutes) || ' minutes')::interval;
  v_local_date := (p_start_at at time zone v_timezone)::date;
  v_dow := extract(dow from v_local_date)::int::text;
  v_day := v_business_hours -> v_dow;

  if v_day is null or (v_day ->> 'closed')::boolean then
    raise exception 'outside_business_hours';
  end if;

  v_open := (v_day ->> 'open')::time;
  v_close := (v_day ->> 'close')::time;

  if (p_start_at at time zone v_timezone)::time < v_open
     or (v_end_at at time zone v_timezone)::time > v_close
  then
    raise exception 'outside_business_hours';
  end if;

  if p_start_at < now() + (v_min_notice_minutes || ' minutes')::interval then
    raise exception 'too_soon';
  end if;

  if v_local_date > (now() at time zone v_timezone)::date + v_max_advance_days then
    raise exception 'too_far_ahead';
  end if;

  select c.user_id into v_customer_user_id
  from public.customers c where c.user_id = auth.uid();

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
end;
$$;


-- #####################################################################
-- 0011_localize_jordan.sql
-- #####################################################################

-- The platform now targets Jordan instead of Saudi Arabia: city keys and
-- default timezone move accordingly (currency is a display-only string in
-- src/lib/i18n.ts, no schema change needed for it).

alter table public.org_settings
  alter column timezone set default 'Asia/Amman';

-- Every org so far was created under the old Saudi-market default —
-- move them to Jordan time too.
update public.org_settings
set timezone = 'Asia/Amman'
where timezone = 'Asia/Riyadh';

-- Remap any organizations already tagged with an old Saudi city key to a
-- Jordanian one. All of this platform's real data so far is the one demo
-- org (test-clinic-smoketest, city='riyadh'); the full CASE list is just
-- defensive in case more test data was created with other keys.
update public.organizations
set city = case city
  when 'riyadh' then 'amman'
  when 'jeddah' then 'amman'
  when 'makkah' then 'amman'
  when 'madinah' then 'amman'
  when 'dammam' then 'zarqa'
  when 'khobar' then 'zarqa'
  when 'taif' then 'salt'
  when 'buraidah' then 'mafraq'
  when 'abha' then 'karak'
  when 'tabuk' then 'irbid'
  else city
end
where city in ('riyadh', 'jeddah', 'makkah', 'madinah', 'dammam', 'khobar', 'taif', 'buraidah', 'abha', 'tabuk');


-- #####################################################################
-- 0012_plan_and_featured.sql
-- #####################################################################

-- V2 blueprint, Phase 0: subscription-plan scaffolding (no billing wired
-- yet — see src/lib/plan.ts, populated in a later phase once gated
-- features exist) and a tiebreaker boost for the home page's featured
-- categories in search ordering. The featured-category LIST itself is a
-- pure app-layer constant (FEATURED_CATEGORIES in src/lib/directory.ts,
-- not persisted here) so it stays reversible without a migration.

alter table public.organizations
  add column plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  add column plan_expires_at timestamptz;

-- ---------------------------------------------------------------------
-- list_directory_orgs(): adds an optional featured-category list used
-- two ways by one parameter, per src/lib/directory.ts's
-- FEATURED_CATEGORIES: (1) home page rows pass p_featured_only=true to
-- hard-restrict to that set, (2) /search passes p_featured_only=false
-- (default) so the same list only nudges ordering, never filters. A new
-- parameter changes the function's identity (name + input types) in
-- Postgres, which `create or replace` would leave as a second overload
-- rather than truly replacing — drop the old signature first, same as
-- get_public_org() in 0006_directory.sql, to avoid PostgREST "ambiguous
-- function" errors from two overloads coexisting.
-- ---------------------------------------------------------------------
drop function public.list_directory_orgs(text, text, text, int, int);

create function public.list_directory_orgs(
  p_city text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0,
  p_featured_categories text[] default null,
  p_featured_only boolean default false
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
  review_count int
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.city, o.district, o.category,
         o.logo_url, o.cover_image_url, o.price_tier,
         round(avg(r.rating)::numeric, 1), count(r.id)::int
  from public.organizations o
  left join public.reviews r on r.org_id = o.id
  where o.is_listed
    and o.deleted_at is null
    and (p_city is null or o.city = p_city)
    and (p_category is null or o.category = p_category)
    and (not p_featured_only or p_featured_categories is null or o.category = any(p_featured_categories))
    and (p_search is null or trim(p_search) = ''
         or o.name ilike '%' || trim(p_search) || '%'
         or o.district ilike '%' || trim(p_search) || '%')
  group by o.id
  order by
    case when p_featured_categories is not null and o.category = any(p_featured_categories) then 0 else 1 end,
    avg(r.rating) desc nulls last,
    o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;

revoke all on function public.list_directory_orgs(text, text, text, int, int, text[], boolean) from public;
grant execute on function public.list_directory_orgs(text, text, text, int, int, text[], boolean) to anon, authenticated;


-- #####################################################################
-- 0013_staff_schedules.sql
-- #####################################################################

-- V2 blueprint, Phase 1: per-staff working hours + time off. Replaces the
-- v1 "staff only filters conflicts, org hours apply to everyone" model
-- with real per-staff availability, while keeping the same GIST exclusion
-- constraint on appointments (resource_id, tstzrange) as the single
-- source of truth for "never double-book."
--
-- Behavior change (intentional): when a customer picks "any available
-- staff" (p_staff_id = null), booking now assigns a REAL staff member at
-- booking time (tries each eligible staff in turn) instead of writing an
-- unassigned row against a single shared org-level resource. For an org
-- with only the owner as staff, effective capacity per slot is unchanged
-- (still 1). For an org with multiple staff, this correctly raises
-- capacity to "however many staff can cover that slot" — the actual
-- point of per-staff scheduling. Old pre-migration unassigned rows
-- (resource_id = org_id) are not staff-conflict-checked going forward;
-- harmless at this project's current data volume (test bookings only).

alter table public.memberships
  add column business_hours jsonb, -- null = inherits org_settings.business_hours
  add column display_name text,
  add column bio text,
  add column photo_url text;

create table public.staff_time_off (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  staff_membership_id uuid not null references public.memberships(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint time_off_end_after_start check (ends_at > starts_at)
);

create index staff_time_off_membership_idx on public.staff_time_off (staff_membership_id, starts_at);

alter table public.staff_time_off enable row level security;

create policy "members can view org staff time off"
  on public.staff_time_off for select
  using (public.is_org_member(org_id));

create policy "owner or self can manage staff time off"
  on public.staff_time_off for all
  using (
    public.is_org_owner(org_id)
    or staff_membership_id in (select id from public.memberships m where m.user_id = auth.uid() and m.org_id = staff_time_off.org_id)
  )
  with check (
    public.is_org_owner(org_id)
    or staff_membership_id in (select id from public.memberships m where m.user_id = auth.uid() and m.org_id = staff_time_off.org_id)
  );

-- ---------------------------------------------------------------------
-- update_staff_profile / update_staff_schedule: owner (any staff) or the
-- staff member themself (own row only).
-- ---------------------------------------------------------------------
create function public.update_staff_profile(
  p_membership_id uuid,
  p_display_name text default null,
  p_bio text default null,
  p_photo_url text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'staff_not_found';
  end if;
  if not (
    public.is_org_owner(v_org_id)
    or exists (select 1 from public.memberships m where m.id = p_membership_id and m.user_id = auth.uid())
  ) then
    raise exception 'not_authorized';
  end if;

  update public.memberships
  set display_name = nullif(trim(coalesce(p_display_name, '')), ''),
      bio = nullif(trim(coalesce(p_bio, '')), ''),
      photo_url = nullif(trim(coalesce(p_photo_url, '')), '')
  where id = p_membership_id;

  return true;
end;
$$;

revoke all on function public.update_staff_profile(uuid, text, text, text) from public;
grant execute on function public.update_staff_profile(uuid, text, text, text) to authenticated;

create function public.update_staff_schedule(p_membership_id uuid, p_business_hours jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'staff_not_found';
  end if;
  if not (
    public.is_org_owner(v_org_id)
    or exists (select 1 from public.memberships m where m.id = p_membership_id and m.user_id = auth.uid())
  ) then
    raise exception 'not_authorized';
  end if;

  update public.memberships set business_hours = p_business_hours where id = p_membership_id;
  return true;
end;
$$;

revoke all on function public.update_staff_schedule(uuid, jsonb) from public;
grant execute on function public.update_staff_schedule(uuid, jsonb) to authenticated;

create function public.add_staff_time_off(
  p_membership_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_id uuid;
begin
  select org_id into v_org_id from public.memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'staff_not_found';
  end if;
  if not (
    public.is_org_owner(v_org_id)
    or exists (select 1 from public.memberships m where m.id = p_membership_id and m.user_id = auth.uid())
  ) then
    raise exception 'not_authorized';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'invalid_range';
  end if;

  insert into public.staff_time_off (org_id, staff_membership_id, starts_at, ends_at, reason)
  values (v_org_id, p_membership_id, p_starts_at, p_ends_at, nullif(trim(coalesce(p_reason, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_staff_time_off(uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.add_staff_time_off(uuid, timestamptz, timestamptz, text) to authenticated;

create function public.remove_staff_time_off(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_membership_id uuid;
begin
  select org_id, staff_membership_id into v_org_id, v_membership_id
  from public.staff_time_off where id = p_id;
  if v_org_id is null then
    return false;
  end if;
  if not (
    public.is_org_owner(v_org_id)
    or exists (select 1 from public.memberships m where m.id = v_membership_id and m.user_id = auth.uid())
  ) then
    raise exception 'not_authorized';
  end if;

  delete from public.staff_time_off where id = p_id;
  return true;
end;
$$;

revoke all on function public.remove_staff_time_off(uuid) from public;
grant execute on function public.remove_staff_time_off(uuid) to authenticated;

create function public.list_staff_time_off(p_org_id uuid)
returns table (id uuid, staff_membership_id uuid, starts_at timestamptz, ends_at timestamptz, reason text)
language sql
security definer
stable
set search_path = public
as $$
  select t.id, t.staff_membership_id, t.starts_at, t.ends_at, t.reason
  from public.staff_time_off t
  where t.org_id = p_org_id and public.is_org_member(p_org_id)
  order by t.starts_at;
$$;

revoke all on function public.list_staff_time_off(uuid) from public;
grant execute on function public.list_staff_time_off(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- list_org_staff(): widened with the new profile/schedule columns —
-- return-type change needs drop + create (create or replace can't do it).
-- ---------------------------------------------------------------------
drop function public.list_org_staff(uuid);

create function public.list_org_staff(p_org_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  role text,
  pending boolean,
  display_name text,
  bio text,
  photo_url text,
  business_hours jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not_authorized';
  end if;

  return query
    select m.id, m.user_id, u.email, m.role, false, m.display_name, m.bio, m.photo_url, m.business_hours
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
  union all
    select null::uuid, null::uuid, i.email, i.role, true, null::text, null::text, null::text, null::jsonb
    from public.invitations i
    where i.org_id = p_org_id and i.accepted_at is null
  order by pending, email;
end;
$$;

revoke all on function public.list_org_staff(uuid) from public;
grant execute on function public.list_org_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- _resource_slots(): shared slot generator, extracted from the old
-- get_available_slots() body. Generates candidate start times for one
-- calendar day from one business_hours jsonb, filtered by min-notice/
-- max-advance, conflicting 'booked' appointments on p_resource_id, and
-- (when given) a staff member's time off. Both get_available_slots() and
-- book_appointment() now call this for a single resource; "any staff"
-- unions it across every eligible staff member.
-- ---------------------------------------------------------------------
create function public._resource_slots(
  p_timezone text,
  p_business_hours jsonb,
  p_slot_interval_minutes int,
  p_min_notice_minutes int,
  p_max_advance_days int,
  p_duration_minutes int,
  p_buffer_minutes int,
  p_date date,
  p_resource_id uuid,
  p_time_off_membership_id uuid default null
)
returns table (start_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date;
  v_dow text;
  v_day jsonb;
  v_open time;
  v_close time;
  v_day_start timestamp;
  v_day_end timestamp;
  v_step interval;
  v_slot_local timestamp;
  v_slot_utc timestamptz;
  v_slot_len interval;
begin
  v_today := (now() at time zone p_timezone)::date;
  if p_date < v_today or p_date > v_today + p_max_advance_days then
    return;
  end if;

  v_dow := extract(dow from p_date)::int::text;
  v_day := p_business_hours -> v_dow;
  if v_day is null or (v_day ->> 'closed')::boolean then
    return;
  end if;

  v_open := (v_day ->> 'open')::time;
  v_close := (v_day ->> 'close')::time;
  v_day_start := p_date::timestamp + v_open;
  v_day_end := p_date::timestamp + v_close;
  v_step := (p_slot_interval_minutes || ' minutes')::interval;
  v_slot_len := ((p_duration_minutes + p_buffer_minutes) || ' minutes')::interval;

  v_slot_local := v_day_start;
  while v_slot_local + v_slot_len <= v_day_end loop
    v_slot_utc := v_slot_local at time zone p_timezone;

    if v_slot_utc >= now() + (p_min_notice_minutes || ' minutes')::interval then
      if not exists (
        select 1 from public.appointments a
        where a.resource_id = p_resource_id
          and a.status = 'booked'
          and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(v_slot_utc, v_slot_utc + v_slot_len, '[)')
      ) and (
        p_time_off_membership_id is null or not exists (
          select 1 from public.staff_time_off t
          where t.staff_membership_id = p_time_off_membership_id
            and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_slot_utc, v_slot_utc + v_slot_len, '[)')
        )
      ) then
        start_at := v_slot_utc;
        return next;
      end if;
    end if;

    v_slot_local := v_slot_local + v_step;
  end loop;
end;
$$;

revoke all on function public._resource_slots(text, jsonb, int, int, int, int, int, date, uuid, uuid) from public;
-- Internal helper only — no anon/authenticated grant. Called exclusively
-- from other security-definer functions in this file, which run under
-- the function owner's privileges regardless of the caller's own grants.

-- ---------------------------------------------------------------------
-- get_available_slots(): same signature as before. staff_id given -> that
-- staff's own hours/time-off. staff_id null -> union of every eligible
-- staff member's slots (staff_services assignment, or all staff if the
-- service has no assignments configured).
-- ---------------------------------------------------------------------
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
  select o.id, o.deleted_at into v_org_id, v_org_deleted_at
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

-- ---------------------------------------------------------------------
-- book_appointment(): same signature/behavior for an explicit staff_id.
-- For "any available" (staff_id null), tries each eligible staff member
-- in turn — the GIST exclusion constraint is still what actually
-- prevents a double-book if two requests race for the same staff.
-- ---------------------------------------------------------------------
create or replace function public.book_appointment(
  p_org_slug text,
  p_service_id uuid,
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_staff_id uuid default null,
  p_customer_email text default null,
  p_notes text default null
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
  v_customer_user_id uuid;
  v_recent_count int;
  v_staff_hours jsonb;
  v_candidate record;
  v_assigned_staff_id uuid;
begin
  if trim(p_customer_name) = '' or trim(p_customer_phone) = '' then
    raise exception 'missing_contact_info';
  end if;

  select count(*) into v_recent_count
  from public.appointments a
  where a.customer_phone = trim(p_customer_phone)
    and a.status = 'booked'
    and a.created_at > now() - interval '1 hour';
  if v_recent_count >= 6 then
    raise exception 'rate_limited';
  end if;

  select o.id, o.deleted_at into v_org_id, v_org_deleted_at
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
    if (p_start_at at time zone v_timezone)::time < v_open or (v_end_at at time zone v_timezone)::time > v_close then
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
    order by m.created_at
  loop
    v_dow := extract(dow from v_local_date)::int::text;
    v_day := v_candidate.hours -> v_dow;
    if v_day is null or (v_day ->> 'closed')::boolean then
      continue;
    end if;
    v_open := (v_day ->> 'open')::time;
    v_close := (v_day ->> 'close')::time;
    if (p_start_at at time zone v_timezone)::time < v_open or (v_end_at at time zone v_timezone)::time > v_close then
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


-- #####################################################################
-- 0014_fix_list_org_staff_order_by.sql
-- #####################################################################

-- Hotfix: list_org_staff() as shipped in 0013 fails on every call with
-- "invalid UNION/INTERSECT/EXCEPT ORDER BY clause — only result column
-- names can be used, not expressions or functions" (postgres 0A000).
-- `order by pending, email` referenced "pending", but the boolean
-- literals `false`/`true` in the SELECT lists are unaliased expressions,
-- not named columns — Postgres has no "pending" name to resolve there
-- regardless of the function's RETURNS TABLE column names (those only
-- shape the final output tuple, they don't name the inner query's own
-- columns for its own ORDER BY). Fix: order by ordinal position instead,
-- which is unambiguous. Same signature/return type as 0013 — plain
-- create or replace is safe (no drop needed since the function IS being
-- fully redefined, not extended).

create or replace function public.list_org_staff(p_org_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  role text,
  pending boolean,
  display_name text,
  bio text,
  photo_url text,
  business_hours jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not_authorized';
  end if;

  return query
    select m.id, m.user_id, u.email, m.role, false, m.display_name, m.bio, m.photo_url, m.business_hours
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
  union all
    select null::uuid, null::uuid, i.email, i.role, true, null::text, null::text, null::text, null::jsonb
    from public.invitations i
    where i.org_id = p_org_id and i.accepted_at is null
  order by 5, 3; -- 5 = pending, 3 = email
end;
$$;


-- #####################################################################
-- 0015_fix_list_org_staff_email_type.sql
-- #####################################################################

-- Second list_org_staff bug, surfaced only after 0014 fixed the ORDER BY
-- error and the function could actually run its type-check: "Returned
-- type character varying does not match expected type text in column 3."
-- auth.users.email is `character varying`, not `text`; a bare UNION ALL
-- resolves the combined column type from the first branch (varchar),
-- which then fails the function's strict `RETURNS TABLE(... email
-- text ...)` check. This looks to have been broken since the function was
-- first created in 0003_staff.sql — confirmed live via a direct RPC call
-- before writing this fix, not assumed. Cast to text explicitly.

create or replace function public.list_org_staff(p_org_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  role text,
  pending boolean,
  display_name text,
  bio text,
  photo_url text,
  business_hours jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not_authorized';
  end if;

  return query
    select m.id, m.user_id, u.email::text, m.role, false, m.display_name, m.bio, m.photo_url, m.business_hours
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
  union all
    select null::uuid, null::uuid, i.email::text, i.role, true, null::text, null::text, null::text, null::jsonb
    from public.invitations i
    where i.org_id = p_org_id and i.accepted_at is null
  order by 5, 3; -- 5 = pending, 3 = email
end;
$$;


-- #####################################################################
-- 0016_org_maps_url.sql
-- #####################################################################

-- Google Maps / location link per organization, shown as a "Get
-- directions" button on the public clinic page. A plain URL the owner
-- pastes from their existing Google Maps listing (share link) is far
-- less friction for a non-technical owner than asking for lat/lng, and
-- needs no geocoding on our side.

alter table public.organizations add column maps_url text;

-- get_public_org(): widened with maps_url. Return-type change requires
-- drop + create (create or replace can't alter it) — same reasoning as
-- the 0006_directory.sql widening this is layered on top of.
drop function public.get_public_org(text);

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
  where o.slug = p_slug and o.deleted_at is null;
$$;

revoke all on function public.get_public_org(text) from public;
grant execute on function public.get_public_org(text) to anon, authenticated;


-- #####################################################################
-- 0017_reserve_password_reset_slugs.sql
-- #####################################################################

-- New static routes for the password-reset flow (src/app/forgot-password,
-- src/app/reset-password) must never be claimable as an org slug, same
-- reasoning as every other reserved_slugs insert (0001_init.sql, 0006_directory.sql).
insert into public.reserved_slugs (slug) values
  ('forgot-password'), ('reset-password')
on conflict do nothing;


-- #####################################################################
-- 0018_org_media_upload_limits.sql
-- #####################################################################

-- Defense in depth for the org-media bucket: the client already checks
-- file type/size before calling storage.upload() (see SettingsClient.tsx),
-- but that only stops the normal UI path — nothing at the bucket level
-- previously stopped a direct API call from uploading an oversized file
-- or an arbitrary (non-image) MIME type into a bucket serving public URLs.
update storage.buckets
set file_size_limit = 5242880, -- 5MB, matches the client-side check
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'org-media';


-- #####################################################################
-- 0019_review_moderation.sql
-- #####################################################################

-- Review moderation: an org owner can hide (or unhide) a review on
-- their own clinic — there was previously no way at all to act on an
-- abusive or fake review short of contacting support directly. The
-- 0008_reviews.sql RLS policy comment already said "members can view
-- org reviews (dashboard)" — that dashboard page never actually got
-- built until now (src/app/(app)/reviews).

alter table public.reviews add column hidden_at timestamptz;

create function public.hide_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.reviews where id = p_review_id;
  if v_org_id is null then
    raise exception 'review_not_found';
  end if;
  if not public.is_org_owner(v_org_id) then
    raise exception 'not_authorized';
  end if;

  update public.reviews set hidden_at = now() where id = p_review_id;
end;
$$;

revoke all on function public.hide_review(uuid) from public;
grant execute on function public.hide_review(uuid) to authenticated;

create function public.unhide_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.reviews where id = p_review_id;
  if v_org_id is null then
    raise exception 'review_not_found';
  end if;
  if not public.is_org_owner(v_org_id) then
    raise exception 'not_authorized';
  end if;

  update public.reviews set hidden_at = null where id = p_review_id;
end;
$$;

revoke all on function public.unhide_review(uuid) from public;
grant execute on function public.unhide_review(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Every public-facing read of reviews/ratings now excludes hidden ones.
-- Same signatures as before → plain create or replace is safe.
-- ---------------------------------------------------------------------
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
  where o.slug = p_org_slug and o.deleted_at is null and r.hidden_at is null
  order by r.created_at desc
  limit greatest(1, least(p_limit, 50))
  offset greatest(0, p_offset);
$$;

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
  where o.slug = p_org_slug and o.deleted_at is null and r.hidden_at is null;
$$;

-- Filter belongs in the JOIN condition, not WHERE — this is a LEFT
-- JOIN, so an org whose only reviews are hidden must still show up
-- with review_count=0/avg_rating=null, not disappear from the listing
-- entirely (WHERE would drop that whole grouped row).
create or replace function public.list_directory_orgs(
  p_city text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0,
  p_featured_categories text[] default null,
  p_featured_only boolean default false
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
  review_count int
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.city, o.district, o.category,
         o.logo_url, o.cover_image_url, o.price_tier,
         round(avg(r.rating)::numeric, 1), count(r.id)::int
  from public.organizations o
  left join public.reviews r on r.org_id = o.id and r.hidden_at is null
  where o.is_listed
    and o.deleted_at is null
    and (p_city is null or o.city = p_city)
    and (p_category is null or o.category = p_category)
    and (not p_featured_only or p_featured_categories is null or o.category = any(p_featured_categories))
    and (p_search is null or trim(p_search) = ''
         or o.name ilike '%' || trim(p_search) || '%'
         or o.district ilike '%' || trim(p_search) || '%')
  group by o.id
  order by
    case when p_featured_categories is not null and o.category = any(p_featured_categories) then 0 else 1 end,
    avg(r.rating) desc nulls last,
    o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;


-- #####################################################################
-- 0020_close_organization.sql
-- #####################################################################

-- Self-service org closure. organizations.deleted_at already exists
-- and every public read (get_public_org, list_directory_orgs,
-- book_appointment, ...) already excludes it — the only missing piece
-- was a way for the owner to actually set it themselves; previously
-- the privacy policy's "contact us to delete your account" was the
-- only route, which is fine at low volume but doesn't scale.
--
-- Soft delete only, same as everywhere else in this schema: existing
-- appointments/reviews/customers are untouched, the org just stops
-- appearing anywhere and can't take new bookings. Reopening requires
-- an admin clearing deleted_at directly for now — no self-service
-- "undo", matching how most "delete my account" flows work.
create function public.close_organization()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
  from public.memberships
  where user_id = auth.uid() and role = 'owner'
  limit 1;

  if v_org_id is null then
    raise exception 'not_authorized';
  end if;

  update public.organizations set deleted_at = now() where id = v_org_id;
end;
$$;

revoke all on function public.close_organization() from public;
grant execute on function public.close_organization() to authenticated;


-- #####################################################################
-- 0021_service_photos.sql
-- #####################################################################

-- A center offering several services (e.g. dental + whitening + braces)
-- previously had no visual way to distinguish them on its public page —
-- just a plain text list. Each service can now carry its own photo.

alter table public.services add column photo_url text;

-- list_public_services(): widened with photo_url. Return-type change
-- requires drop + create, same reasoning as every other widened RPC
-- in this schema (get_public_org in 0006_directory.sql, etc.).
drop function public.list_public_services(text);

create function public.list_public_services(p_org_slug text)
returns table (id uuid, name text, duration_minutes int, price numeric, photo_url text)
language sql
security definer
stable
set search_path = public
as $$
  select sv.id, sv.name, sv.duration_minutes, sv.price, sv.photo_url
  from public.services sv
  join public.organizations o on o.id = sv.org_id
  where o.slug = p_org_slug and o.deleted_at is null and sv.active
  order by sv.sort_order, sv.created_at;
$$;

revoke all on function public.list_public_services(text) from public;
grant execute on function public.list_public_services(text) to anon, authenticated;


-- #####################################################################
-- 0022_staff_without_email.sql
-- #####################################################################

-- Staff without an email account.
--
-- Until now the ONLY way to add a staff member was to invite an email
-- address and wait for that person to create a login. In Jordan most
-- clinic/salon staff simply do not have a work email, so an owner could
-- not even list the people who work there — which also meant the
-- per-staff schedules and the "pick your specialist" booking step were
-- effectively unusable for a typical shop.
--
-- A staff member is really two separable things: a bookable person
-- (name, hours, time off, assigned services) and, optionally, a login.
-- This splits them: memberships.user_id becomes nullable, so a row can
-- represent a real person with no account at all. Inviting by email
-- still works and is now purely opt-in, for staff who need to sign in
-- and see their own day.

alter table public.memberships alter column user_id drop not null;

-- Owner-facing only (never returned by a public RPC) — most owners will
-- want the staff member's WhatsApp number to hand, not an email.
alter table public.memberships add column phone text;

-- The existing `unique (org_id, user_id)` still does the right thing:
-- Postgres treats NULLs as distinct, so an org can hold many
-- account-less staff while still being unable to add the same real
-- account twice.

-- ---------------------------------------------------------------------
-- add_staff_member(): create a bookable person with no login.
-- ---------------------------------------------------------------------
create function public.add_staff_member(p_name text, p_phone text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_id uuid;
begin
  select org_id into v_org_id
  from public.memberships
  where user_id = auth.uid() and role = 'owner'
  limit 1;

  if v_org_id is null then
    raise exception 'not_authorized';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'name_required';
  end if;

  insert into public.memberships (org_id, user_id, role, display_name, phone)
  values (v_org_id, null, 'staff', trim(p_name), nullif(trim(coalesce(p_phone, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_staff_member(text, text) from public;
grant execute on function public.add_staff_member(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- remove_staff_member(): only for a person with no appointment history.
-- appointments.staff_id has no ON DELETE rule (so a raw delete would
-- just error and abort), and silently reassigning or deleting somebody
-- real bookings would be far worse than refusing — so refuse explicitly
-- and let the caller show a proper message.
-- ---------------------------------------------------------------------
create function public.remove_staff_member(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_role text;
begin
  select org_id, role into v_org_id, v_role
  from public.memberships where id = p_membership_id;

  if v_org_id is null then
    raise exception 'staff_not_found';
  end if;
  if not public.is_org_owner(v_org_id) then
    raise exception 'not_authorized';
  end if;
  if v_role = 'owner' then
    raise exception 'cannot_remove_owner';
  end if;
  if exists (select 1 from public.appointments a where a.staff_id = p_membership_id) then
    raise exception 'staff_has_bookings';
  end if;

  delete from public.memberships where id = p_membership_id;
end;
$$;

revoke all on function public.remove_staff_member(uuid) from public;
grant execute on function public.remove_staff_member(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- update_staff_profile(): gains phone. Signature change → drop first.
-- ---------------------------------------------------------------------
drop function public.update_staff_profile(uuid, text, text, text);

create function public.update_staff_profile(
  p_membership_id uuid,
  p_display_name text default null,
  p_bio text default null,
  p_photo_url text default null,
  p_phone text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_user_id uuid;
begin
  select org_id, user_id into v_org_id, v_user_id
  from public.memberships where id = p_membership_id;

  if v_org_id is null then
    raise exception 'staff_not_found';
  end if;
  -- Owner may edit anyone; a staff member with a login may edit only
  -- their own row. An account-less row (user_id null) is owner-only,
  -- which the is_org_owner branch already covers.
  if not (public.is_org_owner(v_org_id) or (v_user_id is not null and v_user_id = auth.uid())) then
    raise exception 'not_authorized';
  end if;

  update public.memberships
  set display_name = coalesce(nullif(trim(coalesce(p_display_name, '')), ''), display_name),
      bio = coalesce(p_bio, bio),
      photo_url = coalesce(p_photo_url, photo_url),
      phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone)
  where id = p_membership_id;

  return true;
end;
$$;

revoke all on function public.update_staff_profile(uuid, text, text, text, text) from public;
grant execute on function public.update_staff_profile(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- list_org_staff(): LEFT JOIN so account-less staff actually appear (an
-- inner join would silently hide every person added by name), and
-- surface phone. Return-type change → drop first.
-- ---------------------------------------------------------------------
drop function public.list_org_staff(uuid);

create function public.list_org_staff(p_org_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  phone text,
  role text,
  pending boolean,
  display_name text,
  bio text,
  photo_url text,
  business_hours jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not_authorized';
  end if;

  return query
    select m.id, m.user_id, u.email::text, m.phone, m.role, false,
           m.display_name, m.bio, m.photo_url, m.business_hours
    from public.memberships m
    left join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
  union all
    select null::uuid, null::uuid, i.email::text, null::text, i.role, true,
           null::text, null::text, null::text, null::jsonb
    from public.invitations i
    where i.org_id = p_org_id and i.accepted_at is null
  order by 6, 7 nulls last, 3; -- pending, then display_name, then email
end;
$$;

revoke all on function public.list_org_staff(uuid) from public;
grant execute on function public.list_org_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- list_public_staff_for_service(): return the person NAME, not their
-- email address. This RPC is granted to anon and feeds the "choose your
-- specialist" step, so until now every customer picking a staff member
-- was shown that employee private email as the option label. An
-- account-less staff member has no email to show at all, so this had to
-- change regardless. Return-type change → drop first.
-- ---------------------------------------------------------------------
drop function public.list_public_staff_for_service(text, uuid);

create function public.list_public_staff_for_service(p_org_slug text, p_service_id uuid)
returns table (membership_id uuid, name text)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.display_name
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where o.slug = p_org_slug and o.deleted_at is null
    -- Only people who actually have a name. display_name was added in
    -- 0013 with no backfill and its only writer (update_staff_profile)
    -- was never wired to any UI, so EVERY row predating this migration
    -- has it NULL — without this filter every existing clinic would show
    -- the customer a list of identical "موظف" entries, which is worse
    -- for choosing than the email it replaces. Capacity is unaffected:
    -- an unnamed person is still booked through "any available staff",
    -- because get_available_slots with p_staff_id null scans every
    -- membership regardless of name.
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

revoke all on function public.list_public_staff_for_service(text, uuid) from public;
grant execute on function public.list_public_staff_for_service(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Linking an email invite to an existing account-less staff row.
--
-- Without this, the natural flow silently creates a DUPLICATE person:
-- add "Ahmad" by name (user_id null), then invite Ahmad by email, and on
-- acceptance get_my_context (0003) runs
--   insert into memberships (org_id, user_id, role) ...
--   on conflict (org_id, user_id) do nothing
-- whose arbiter is unique (org_id, user_id) — NULLs are distinct, so it
-- can never match the account-less row, and nothing anywhere else ever
-- assigns user_id to an existing row. Ahmad ends up as two memberships.
--
-- That is not merely untidy: appointments.resource_id is
-- generated always as coalesce(staff_id, org_id) and the no-overlap GIST
-- exclusion is keyed on it (0004), so two membership ids are two
-- independent resources and the constraint cannot stop one real person
-- being booked twice at the same minute. His schedule, time off and
-- service assignments also stay on the row he cannot edit, since every
-- self-service check keys on user_id = auth.uid().
-- ---------------------------------------------------------------------
alter table public.invitations
  add column membership_id uuid references public.memberships(id) on delete cascade;

create unique index invitations_membership_id_idx
  on public.invitations (membership_id) where membership_id is not null;

drop function public.invite_staff(uuid, text, text);

create function public.invite_staff(
  p_org_id uuid,
  p_email text,
  p_role text default 'staff',
  p_membership_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_org_owner(p_org_id) then
    raise exception 'not_authorized';
  end if;

  if p_role not in ('owner', 'staff') then
    raise exception 'invalid_role';
  end if;

  -- Only ever link a row that belongs to this org and has no login yet,
  -- so an invite can never be pointed at somebody else's account.
  if p_membership_id is not null and not exists (
    select 1 from public.memberships m
    where m.id = p_membership_id and m.org_id = p_org_id and m.user_id is null
  ) then
    raise exception 'invalid_staff_link';
  end if;

  insert into public.invitations (org_id, email, role, membership_id)
  values (p_org_id, lower(trim(p_email)), p_role, p_membership_id)
  on conflict (org_id, email) do update
    set role = excluded.role,
        membership_id = excluded.membership_id,
        accepted_at = null
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.invite_staff(uuid, text, text, uuid) from public;
grant execute on function public.invite_staff(uuid, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_my_context(): adopt a linked account-less staff row on invite
-- acceptance, instead of inserting a duplicate membership. Signature and
-- return type are unchanged, so create or replace is correct here (no
-- DROP). Body is the 0003 version with only the acceptance block changed.
-- ---------------------------------------------------------------------
create or replace function public.get_my_context()
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
  deleted_at timestamptz
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
      v_role, o.deleted_at
    from public.organizations o
    join public.org_settings s on s.org_id = o.id
    where o.id = v_org_id;
end;
$$;


-- #####################################################################
-- 0023_staff_title.sql
-- #####################################################################

-- Professional title per staff member ("د.", "استشاري", "أخصائية جلدية",
-- "خبيرة تجميل", "حلاق"...). Deliberately free text rather than a fixed
-- list: this app serves dental clinics, dermatology, laser centres,
-- ladies salons and barbershops, and no single vocabulary covers all of
-- them in both Arabic and English.
--
-- Separate from display_name so the two can be rendered differently
-- (the title is a qualifier, the name is the identity) and so an owner
-- can set one without disturbing the other.
--
-- A NEW migration rather than an edit to 0022, because 0022 may already
-- have been applied — never mutate a migration that might have run.

alter table public.memberships add column title text;

-- ---------------------------------------------------------------------
-- add_staff_member(): gains title. Parameter list changes the function
-- identity, so DROP the 0022 signature first or both would coexist and
-- PostgREST would report an ambiguous overload.
-- ---------------------------------------------------------------------
drop function public.add_staff_member(text, text);

create function public.add_staff_member(
  p_name text,
  p_title text default null,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_id uuid;
begin
  select org_id into v_org_id
  from public.memberships
  where user_id = auth.uid() and role = 'owner'
  limit 1;

  if v_org_id is null then
    raise exception 'not_authorized';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'name_required';
  end if;

  insert into public.memberships (org_id, user_id, role, display_name, title, phone)
  values (
    v_org_id, null, 'staff', trim(p_name),
    nullif(trim(coalesce(p_title, '')), ''),
    nullif(trim(coalesce(p_phone, '')), '')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_staff_member(text, text, text) from public;
grant execute on function public.add_staff_member(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- update_staff_profile(): gains title. Signature change → drop first.
-- Passing NULL still means "leave unchanged" for every field, so a
-- caller editing only the name cannot silently wipe the title.
-- ---------------------------------------------------------------------
drop function public.update_staff_profile(uuid, text, text, text, text);

create function public.update_staff_profile(
  p_membership_id uuid,
  p_display_name text default null,
  p_bio text default null,
  p_photo_url text default null,
  p_phone text default null,
  p_title text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_user_id uuid;
begin
  select org_id, user_id into v_org_id, v_user_id
  from public.memberships where id = p_membership_id;

  if v_org_id is null then
    raise exception 'staff_not_found';
  end if;
  if not (public.is_org_owner(v_org_id) or (v_user_id is not null and v_user_id = auth.uid())) then
    raise exception 'not_authorized';
  end if;

  update public.memberships
  set display_name = coalesce(nullif(trim(coalesce(p_display_name, '')), ''), display_name),
      bio = coalesce(p_bio, bio),
      photo_url = coalesce(p_photo_url, photo_url),
      phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
      title = coalesce(nullif(trim(coalesce(p_title, '')), ''), title)
  where id = p_membership_id;

  return true;
end;
$$;

revoke all on function public.update_staff_profile(uuid, text, text, text, text, text) from public;
grant execute on function public.update_staff_profile(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- list_org_staff(): surface title. Return-type change → drop first.
-- ---------------------------------------------------------------------
drop function public.list_org_staff(uuid);

create function public.list_org_staff(p_org_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  phone text,
  title text,
  role text,
  pending boolean,
  display_name text,
  bio text,
  photo_url text,
  business_hours jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not_authorized';
  end if;

  return query
    select m.id, m.user_id, u.email::text, m.phone, m.title, m.role, false,
           m.display_name, m.bio, m.photo_url, m.business_hours
    from public.memberships m
    left join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
  union all
    select null::uuid, null::uuid, i.email::text, null::text, null::text, i.role, true,
           null::text, null::text, null::text, null::jsonb
    from public.invitations i
    where i.org_id = p_org_id and i.accepted_at is null
  order by 7, 8 nulls last, 3; -- pending, then display_name, then email
end;
$$;

revoke all on function public.list_org_staff(uuid) from public;
grant execute on function public.list_org_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- list_public_staff_for_service(): the title is the whole point of this
-- change — customers pick "د. أحمد", not "أحمد". Return-type change →
-- drop first. Still restricted to staff who actually have a name, for
-- the reason given in 0022.
-- ---------------------------------------------------------------------
drop function public.list_public_staff_for_service(text, uuid);

create function public.list_public_staff_for_service(p_org_slug text, p_service_id uuid)
returns table (membership_id uuid, name text, title text)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.display_name, m.title
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where o.slug = p_org_slug and o.deleted_at is null
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

revoke all on function public.list_public_staff_for_service(text, uuid) from public;
grant execute on function public.list_public_staff_for_service(text, uuid) to anon, authenticated;


-- #####################################################################
-- 0024_account_deletion.sql
-- #####################################################################

-- Permanent account deletion, for customers and for clinic owners, with
-- a 15-day grace period — plus the clinic-facing notification inbox the
-- cancellations feed into.
--
-- Shape of the flow:
--   1. The user asks to delete. Immediately: every FUTURE booking of
--      theirs is cancelled, and each affected clinic gets a notification
--      right away — not after the grace period. A clinic that finds out
--      15 days later has already sat waiting for a patient who was never
--      coming, and the appointment is long past.
--   2. For 15 days nothing is destroyed and the user can undo.
--   3. After 15 days a cron purge deletes the auth user for real.
--
-- What survives the purge, by explicit product decision: the clinic
-- keeps its own booking records. appointments.customer_name /
-- customer_phone are plain columns on the appointment, so the clinic's
-- history, revenue and no-show stats stay intact; only the LINK to the
-- (now deleted) account goes away. Note this means deletion is not
-- absolute erasure everywhere — the privacy policy is updated to say so
-- rather than promising something the system does not do.

-- ---------------------------------------------------------------------
-- Without this the purge simply fails: appointments.customer_user_id was
-- declared `references auth.users(id)` with NO on-delete rule (0004:25),
-- which defaults to NO ACTION, so deleting a user who has ever booked
-- raises a foreign-key violation and aborts. SET NULL is also exactly
-- the semantics we want: unlink the account, keep the booking.
-- ---------------------------------------------------------------------
alter table public.appointments
  drop constraint appointments_customer_user_id_fkey;

alter table public.appointments
  add constraint appointments_customer_user_id_fkey
  foreign key (customer_user_id) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------
-- Clinic-facing notification inbox. Nothing like this existed: the only
-- notification machinery was outbound Web Push to CUSTOMERS (0009).
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('booking_cancelled')),
  title text not null,
  body text,
  -- SET NULL, not CASCADE: the notification is the record that something
  -- was cancelled, and must outlive the row it refers to.
  appointment_id uuid references public.appointments(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_org_created_idx
  on public.notifications (org_id, created_at desc);
create index notifications_org_unread_idx
  on public.notifications (org_id) where read_at is null;

alter table public.notifications enable row level security;

-- Read-only for members; writes happen through security-definer
-- functions, so a member cannot forge or rewrite a notification.
create policy "members can view org notifications"
  on public.notifications for select
  using (public.is_org_member(org_id));

create function public.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
  from public.memberships where user_id = auth.uid() limit 1;

  if v_org_id is null then
    raise exception 'not_authorized';
  end if;

  update public.notifications
  set read_at = now()
  where org_id = v_org_id and read_at is null;
end;
$$;

revoke all on function public.mark_notifications_read() from public;
grant execute on function public.mark_notifications_read() to authenticated;

-- ---------------------------------------------------------------------
-- Pending deletions. Row present = deletion scheduled; deleting the row
-- is the undo. ON DELETE CASCADE so a purged user takes their own row.
-- ---------------------------------------------------------------------
create table public.account_deletions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kind text not null check (kind in ('customer', 'owner')),
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null default now() + interval '15 days'
);

alter table public.account_deletions enable row level security;

create policy "users can see their own deletion request"
  on public.account_deletions for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- request_account_deletion(): schedule deletion, cancel future bookings
-- now, and tell every affected clinic now.
-- ---------------------------------------------------------------------
create function public.request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_kind text;
  v_purge_after timestamptz;
  r record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select org_id into v_org_id
  from public.memberships
  where user_id = v_uid and role = 'owner'
  limit 1;

  v_kind := case when v_org_id is null then 'customer' else 'owner' end;

  insert into public.account_deletions (user_id, kind)
  values (v_uid, v_kind)
  on conflict (user_id) do update set kind = excluded.kind
  returning purge_after into v_purge_after;

  if v_kind = 'customer' then
    -- Cancel this customer's future bookings and notify each clinic, one
    -- notification per booking so the clinic sees which slot freed up.
    for r in
      update public.appointments a
      set status = 'cancelled'
      where a.customer_user_id = v_uid
        and a.status = 'booked'
        and a.start_at > now()
      returning a.id, a.org_id, a.customer_name, a.start_at
    loop
      insert into public.notifications (org_id, kind, title, body, appointment_id)
      values (
        r.org_id,
        'booking_cancelled',
        r.customer_name,
        to_char(r.start_at, 'YYYY-MM-DD HH24:MI'),
        r.id
      );
    end loop;
  else
    -- An owner deleting their account takes the clinic with it: hide it
    -- from the marketplace at once and cancel everything still upcoming,
    -- so no customer keeps a booking at a clinic that is closing. No
    -- notification here — the clinic is the one leaving.
    update public.organizations set deleted_at = now() where id = v_org_id;

    update public.appointments
    set status = 'cancelled'
    where org_id = v_org_id and status = 'booked' and start_at > now();
  end if;

  return v_purge_after;
end;
$$;

revoke all on function public.request_account_deletion() from public;
grant execute on function public.request_account_deletion() to authenticated;

-- ---------------------------------------------------------------------
-- cancel_account_deletion(): undo, only inside the grace window.
-- Deliberately does NOT un-cancel the bookings — those slots may already
-- have been taken by someone else, so silently reinstating them could
-- double-book. Say so in the UI instead of pretending.
-- ---------------------------------------------------------------------
create function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select kind into v_kind
  from public.account_deletions
  where user_id = v_uid and purge_after > now();

  if v_kind is null then
    raise exception 'no_pending_deletion';
  end if;

  if v_kind = 'owner' then
    select org_id into v_org_id
    from public.memberships where user_id = v_uid and role = 'owner' limit 1;
    if v_org_id is not null then
      update public.organizations set deleted_at = null where id = v_org_id;
    end if;
  end if;

  delete from public.account_deletions where user_id = v_uid;
end;
$$;

revoke all on function public.cancel_account_deletion() from public;
grant execute on function public.cancel_account_deletion() to authenticated;

-- ---------------------------------------------------------------------
-- purge_due_accounts(): the real deletion, once the 15 days are up.
-- Secret-gated exactly like claim_due_reminders (0009) — called from
-- /api/cron/purge-accounts with an anon client and no user session.
-- Deleting the auth user cascades to customers, memberships and
-- push_subscriptions, and NULLs appointments.customer_user_id thanks to
-- the constraint swapped at the top of this migration.
-- ---------------------------------------------------------------------
create function public.purge_due_accounts(p_secret text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_secret is distinct from (select value from public.app_config where key = 'cron_secret') then
    raise exception 'not_authorized';
  end if;

  with due as (
    select user_id from public.account_deletions where purge_after <= now()
  ), gone as (
    delete from auth.users u using due where u.id = due.user_id returning u.id
  )
  select count(*)::int into v_count from gone;

  return v_count;
end;
$$;

revoke all on function public.purge_due_accounts(text) from public;
grant execute on function public.purge_due_accounts(text) to anon, authenticated;


-- #####################################################################
-- 0025_fix_account_purge.sql
-- #####################################################################

-- Fixes for 0024, found by adversarial review AFTER 0024 was applied —
-- hence a new migration rather than an edit to it.
--
-- 0024 shipped a 15-day fuse that could not actually fire for a clinic
-- owner, and an "undo" the owner could never reach. Both were verified
-- against the live schema before writing this.

-- ---------------------------------------------------------------------
-- 1. BLOCKER: purging an OWNER always aborted.
--
--    memberships.user_id is ON DELETE CASCADE (0001:53), but
--    appointments.staff_id references memberships(id) with no ON DELETE
--    rule (0004:14), i.e. NO ACTION. So `delete from auth.users`
--    cascade-deleted the membership, which then violated
--    appointments_staff_id_fkey and aborted the whole statement.
--
--    Since 0013 every booking carries a real membership id as staff_id
--    (the any-staff loop inserts v_candidate.membership_id), so for a
--    solo clinic the owner's own membership is staff_id on every
--    appointment the clinic ever took. This was the default path, not an
--    edge case: no owner of a clinic that had taken a single booking
--    could ever be purged.
--
--    The fix is to detach rather than cascade. 0022 made user_id nullable
--    exactly to express "a real bookable person with no login", which is
--    precisely what a purged owner's row should become: the clinic keeps
--    its schedule and its history of who saw whom, the login goes away.
--
--    NOT chosen: ON DELETE SET NULL on appointments.staff_id. resource_id
--    is `generated always as (coalesce(staff_id, org_id)) stored` and
--    feeds the no_overlap GiST exclusion, so nulling staff_id would
--    collapse separate staff onto one resource and trade the FK abort for
--    an exclusion-violation abort — while also destroying the record of
--    which staff member saw which patient.
--
--    Safe because: user_id is already nullable (0022); unique
--    (org_id, user_id) tolerates many NULLs since NULLs are distinct;
--    is_org_member/is_org_owner compare user_id = auth.uid(), which never
--    matches NULL, so a detached row grants nobody any access.
-- ---------------------------------------------------------------------
alter table public.memberships
  drop constraint memberships_user_id_fkey;

alter table public.memberships
  add constraint memberships_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. BLOCKER: the purge was a single all-or-nothing statement.
--
--    One unpurgeable row aborted the entire batch, the cron route
--    returned 500, the offending account_deletions row stayed due, and
--    the identical failure repeated every night while the queue grew —
--    so one bad account silently blocked deletion for everybody.
--
--    Now: one subtransaction per account, so a failure is isolated,
--    logged, and retried next run without holding up the rest.
--
--    Also hardens the secret check. `p_secret is distinct from (select
--    ...)` passes when BOTH sides are NULL, so if the app_config row
--    were ever missing, a call with p_secret=null would be treated as
--    authorised. Verified not exploitable today (the row exists — a null
--    secret is correctly rejected), but the guard should not depend on
--    that. NOTE: claim_due_reminders and delete_push_subscription (0009)
--    share this exact pattern and are worth the same treatment.
--
--    Signature and return type are unchanged, so create or replace is
--    correct here and the cron route keeps working untouched.
-- ---------------------------------------------------------------------
create or replace function public.purge_due_accounts(p_secret text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_count int := 0;
  r record;
begin
  select value into v_secret from public.app_config where key = 'cron_secret';

  -- Explicit null checks: never let a missing config row become an open door.
  if v_secret is null or p_secret is null or p_secret is distinct from v_secret then
    raise exception 'not_authorized';
  end if;

  for r in
    select user_id from public.account_deletions
    where purge_after <= now()
    order by purge_after
  loop
    begin
      -- Detach the login from the person BEFORE deleting the user. The
      -- FK above would do this anyway, but doing it explicitly also lets
      -- us keep the row identifiable: create_organization inserts the
      -- owner membership with no display_name (0001), so a purged owner
      -- would otherwise be left both loginless AND nameless, and
      -- list_public_staff_for_service (0022) hides unnamed staff.
      -- u.email::text because auth.users.email is varchar — the exact
      -- type mismatch that broke list_org_staff in 0015.
      update public.memberships m
      set user_id = null,
          display_name = coalesce(
            nullif(trim(coalesce(m.display_name, '')), ''),
            split_part((select u.email::text from auth.users u where u.id = m.user_id), '@', 1)
          )
      where m.user_id = r.user_id;

      delete from auth.users where id = r.user_id;
      v_count := v_count + 1;
    exception
      when others then
        -- Per-account subtransaction: one bad row cannot abort the batch.
        raise warning 'purge failed for %: %', r.user_id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.purge_due_accounts(text) from public;
grant execute on function public.purge_due_accounts(text) to anon, authenticated;


-- #####################################################################
-- 0026_multi_service_and_customer_conflict.sql
-- #####################################################################

-- Two gaps, fixed together.
--
-- 1. Nothing stopped ONE CUSTOMER holding two overlapping appointments.
--    The no_overlap GiST exclusion keys on resource_id (the staff
--    member), so it stops a doctor being booked twice — but a patient
--    could book 3pm with Dr A and 3pm with Dr B, at the same centre or
--    two different ones, and nothing objected. One of those doctors then
--    waits for a patient who was never able to come.
--
-- 2. Booking two services meant running the whole flow twice, picking
--    each time independently, so a customer wanting back-to-back
--    treatments could easily end up with a two-hour gap between them.
--
-- The signature of book_appointment changes (new p_allow_overlap), so it
-- is dropped and recreated rather than replaced — the repeated rule in
-- this schema, or PostgREST ends up seeing two overloads.

drop function public.book_appointment(text, uuid, timestamptz, text, text, uuid, text, text);

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
  v_customer_user_id uuid;
  v_recent_count int;
  v_staff_hours jsonb;
  v_candidate record;
  v_assigned_staff_id uuid;
begin
  if trim(p_customer_name) = '' or trim(p_customer_phone) = '' then
    raise exception 'missing_contact_info';
  end if;

  select count(*) into v_recent_count
  from public.appointments a
  where a.customer_phone = trim(p_customer_phone)
    and a.status = 'booked'
    and a.created_at > now() - interval '1 hour';
  if v_recent_count >= 6 then
    raise exception 'rate_limited';
  end if;

  select o.id, o.deleted_at into v_org_id, v_org_deleted_at
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

  -- A person cannot be in two places at once. The no_overlap exclusion
  -- guards the STAFF calendar (resource_id); nothing has ever guarded
  -- the CUSTOMER, so the same patient could hold 3pm with Dr A and 3pm
  -- with Dr B — and one of those doctors would sit waiting for someone
  -- who could never arrive.
  --
  -- Matched on the signed-in account when there is one, and always on
  -- the phone reduced to digits so "0599 999 901" and "0599999901" are
  -- recognised as the same person. Checked across ALL clinics, since
  -- being busy at another clinic is exactly the case this catches.
  --
  -- Overridable rather than absolute: one phone legitimately books for a
  -- whole family (a parent plus two children in the same hour), which a
  -- hard constraint would make impossible. The caller confirms and
  -- retries with p_allow_overlap.
  if not p_allow_overlap and exists (
    select 1
    from public.appointments a
    where a.status = 'booked'
      and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start_at, v_end_at, '[)')
      and (
        (auth.uid() is not null and a.customer_user_id = auth.uid())
        or regexp_replace(a.customer_phone, '\D', '', 'g')
           = regexp_replace(trim(p_customer_phone), '\D', '', 'g')
      )
  ) then
    raise exception 'customer_time_conflict';
  end if;
  v_local_date := (p_start_at at time zone v_timezone)::date;

  select c.user_id into v_customer_user_id
  from public.customers c where c.user_id = auth.uid();

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
    if (p_start_at at time zone v_timezone)::time < v_open or (v_end_at at time zone v_timezone)::time > v_close then
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
    order by m.created_at
  loop
    v_dow := extract(dow from v_local_date)::int::text;
    v_day := v_candidate.hours -> v_dow;
    if v_day is null or (v_day ->> 'closed')::boolean then
      continue;
    end if;
    v_open := (v_day ->> 'open')::time;
    v_close := (v_day ->> 'close')::time;
    if (p_start_at at time zone v_timezone)::time < v_open or (v_end_at at time zone v_timezone)::time > v_close then
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

-- The DROP above discarded the grants 0004 gave this function, so they
-- must be restated for the new signature — without this, booking fails
-- for every anonymous customer.
revoke all on function public.book_appointment(text, uuid, timestamptz, text, text, uuid, text, text, boolean) from public;
grant execute on function public.book_appointment(text, uuid, timestamptz, text, text, uuid, text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- _staff_free_for(): is there an eligible staff member genuinely free
-- for this exact window? Returns their membership id, or NULL.
--
-- Needed because a chain's later segments start at arbitrary offsets (a
-- 20-minute service pushes the next one off the slot grid entirely), so
-- they cannot be answered by looking a time up in a generated slot list.
-- This checks the real hours, time off and bookings instead.
--
-- No anon/authenticated grant: called only from other security-definer
-- functions, which reach it through the owner's privileges.
-- ---------------------------------------------------------------------
create function public._staff_free_for(
  p_org_id uuid,
  p_service_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_timezone text,
  p_org_hours jsonb,
  p_staff_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  v_dow text;
  v_day jsonb;
  v_open time;
  v_close time;
begin
  for c in
    select m.id, coalesce(m.business_hours, p_org_hours) as hours
    from public.memberships m
    where m.org_id = p_org_id
      and (p_staff_id is null or m.id = p_staff_id)
      and (
        not exists (select 1 from public.staff_services ss where ss.service_id = p_service_id)
        or exists (
          select 1 from public.staff_services ss
          where ss.service_id = p_service_id and ss.staff_membership_id = m.id
        )
      )
    order by m.created_at
  loop
    v_dow := extract(dow from (p_start at time zone p_timezone))::int::text;
    v_day := c.hours -> v_dow;
    if v_day is null or (v_day ->> 'closed')::boolean then
      continue;
    end if;

    v_open := (v_day ->> 'open')::time;
    v_close := (v_day ->> 'close')::time;
    if (p_start at time zone p_timezone)::time < v_open
       or (p_end at time zone p_timezone)::time > v_close then
      continue;
    end if;

    if exists (
      select 1 from public.staff_time_off t
      where t.staff_membership_id = c.id
        and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
    ) then
      continue;
    end if;

    if exists (
      select 1 from public.appointments a
      where a.resource_id = c.id
        and a.status = 'booked'
        and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start, p_end, '[)')
    ) then
      continue;
    end if;

    return c.id;
  end loop;

  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- get_available_slots_chain(): start times where the WHOLE run of
-- services fits back to back. Each segment may be served by a different
-- staff member (a medical centre books dental then dermatology with two
-- different doctors) unless a specific staff member is requested, in
-- which case that one person must cover every segment.
-- ---------------------------------------------------------------------
create function public.get_available_slots_chain(
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
  where o.slug = p_org_slug and o.deleted_at is null;

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

revoke all on function public.get_available_slots_chain(text, uuid[], date, uuid) from public;
grant execute on function public.get_available_slots_chain(text, uuid[], date, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- book_appointment_chain(): book several services back to back in ONE
-- transaction. Each segment delegates to book_appointment so there is
-- exactly one implementation of the hours / notice / rate-limit /
-- conflict rules — and because a raise anywhere rolls the whole thing
-- back, a customer can never be left with half a visit booked.
--
-- Consecutive segments are adjacent, not overlapping ('[)' ranges), so
-- the customer-conflict guard added above does not fire against the
-- chain's own earlier appointments.
-- ---------------------------------------------------------------------
create function public.book_appointment_chain(
  p_org_slug text,
  p_service_ids uuid[],
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_staff_id uuid default null,
  p_customer_email text default null,
  p_notes text default null,
  p_allow_overlap boolean default false
)
returns table (id uuid, cancel_token uuid, service_id uuid, start_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor timestamptz := p_start_at;
  v_service_id uuid;
  v_duration int;
  v_buffer int;
  v_booked record;
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'no_services';
  end if;

  foreach v_service_id in array p_service_ids loop
    select sv.duration_minutes, sv.buffer_minutes
    into v_duration, v_buffer
    from public.services sv
    join public.organizations o on o.id = sv.org_id
    where sv.id = v_service_id and o.slug = p_org_slug and sv.active;

    if v_duration is null then
      raise exception 'service_not_found';
    end if;

    select b.id, b.cancel_token
    into v_booked
    from public.book_appointment(
      p_org_slug, v_service_id, v_cursor,
      p_customer_name, p_customer_phone, p_staff_id,
      p_customer_email, p_notes, p_allow_overlap
    ) b;

    id := v_booked.id;
    cancel_token := v_booked.cancel_token;
    service_id := v_service_id;
    start_at := v_cursor;
    return next;

    v_cursor := v_cursor + ((v_duration + v_buffer) || ' minutes')::interval;
  end loop;
end;
$$;

revoke all on function public.book_appointment_chain(text, uuid[], timestamptz, text, text, uuid, text, text, boolean) from public;
grant execute on function public.book_appointment_chain(text, uuid[], timestamptz, text, text, uuid, text, text, boolean) to anon, authenticated;


-- #####################################################################
-- 0027_fix_0026.sql
-- #####################################################################

-- Fixes for 0026, which is already applied — so this is a follow-up
-- rather than an edit. 0026 cannot be re-run: its leading
-- "drop function public.book_appointment(text, uuid, timestamptz, text,
-- text, uuid, text, text)" names a signature that no longer exists.
--
-- An adversarial review of 0026 raised 33 claims; 21 survived refutation
-- and the ones with a demonstrated failure are fixed here. Each section
-- says what breaks and how it was verified.
--
-- NOTHING in this file changes a function's parameter list or return
-- type, so every function is replaced with "create or replace" and keeps
-- its existing grants. That is deliberate: 0024 taught us that a DROP
-- silently discards grants, and 0026 needed a whole comment block to
-- restate them. The one genuinely new function gets its grants stated in
-- full.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SECURITY — _staff_free_for was callable by anyone.
--
-- 0026's comment claims "No anon/authenticated grant: called only from
-- other security-definer functions". True as far as it goes — but
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, and the
-- revoke that 0013 pairs with the analogous _resource_slots helper
-- (0013:337) was not copied across. Confirmed against production:
--
--   POST /rest/v1/rpc/_staff_free_for  ->  200, "1354eeda-…"
--
-- It is SECURITY DEFINER over memberships, staff_time_off and
-- appointments — none of which grant anon a select policy — and it
-- applies no min-notice, no max-advance and no date bound, so occupancy
-- was probeable for arbitrary past and future windows. Caller-supplied
-- p_org_hours also neutralised the hours filter.
--
-- get_available_slots_chain still reaches it: a SECURITY DEFINER
-- function runs as its owner, so it does not need a grant of its own.
-- This is exactly how get_available_slots still calls _resource_slots.
-- ---------------------------------------------------------------------
revoke all on function public._staff_free_for(uuid, uuid, timestamptz, timestamptz, text, jsonb, uuid) from public;


-- ---------------------------------------------------------------------
-- 2. Phone normalisation, extracted so the conflict guard, the rate
--    limiter and the indexes below all agree on what "same person" means.
--
-- 0026 compared regexp_replace(phone, '\D', '', 'g') on both sides. Two
-- problems:
--
--   * A phone with no ASCII digit at all normalises to ''. customer_phone
--     is only validated as non-blank (0004:23 has no CHECK, and both
--     inputs are bare text fields), so a walk-in entered as "-" matched
--     EVERY other digit-less row. Because the guard is deliberately
--     cross-clinic, one clinic's placeholder blocked an unrelated
--     customer at another clinic. nullif() makes the comparison NULL
--     rather than TRUE, so it correctly does not fire.
--
--   * Postgres '\D' is ASCII-only, so Arabic-Indic ٠٧٩… collapsed to ''
--     as well — a real number reduced to the placeholder case. Folded
--     here before stripping, and applied to the STORED column too, since
--     rows written before today may already hold Arabic-Indic numerals.
--
-- Also folds the country code, so a customer who gives 0791234567 to the
-- clinic and +962791234567 to the website is recognised as one person.
--
-- No "set search_path" on purpose: this is used in an index expression,
-- so it must be IMMUTABLE, and it touches nothing but pg_catalog
-- builtins. It is not SECURITY DEFINER, so it runs as the caller.
-- ---------------------------------------------------------------------
create or replace function public._norm_phone(p_phone text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    case
      when d ~ '^00962' then '0' || substr(d, 6)
      when d ~ '^962'   then '0' || substr(d, 4)
      when d = ''       then ''
      when d ~ '^0'     then d
      else '0' || d
    end, '')
  from (
    select regexp_replace(
             translate(coalesce(p_phone, ''),
                       '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
                       '01234567890123456789'),
             '\D', '', 'g') as d
  ) s;
$$;

revoke all on function public._norm_phone(text) from public;


-- ---------------------------------------------------------------------
-- 3. Indexes for the two cross-clinic scans on the insert path.
--
-- Every existing index on appointments is unusable for the 0026 guard:
-- appointments_org_start_idx and appointments_staff_idx have no qual on
-- their leading columns (the guard is deliberately cross-clinic), and
-- the no_overlap GiST is led by resource_id, which is unconstrained. So
-- book_appointment went from one linear scan (the 0010 rate limiter) to
-- two — multiplied by segment count inside book_appointment_chain.
-- ---------------------------------------------------------------------
create index if not exists appointments_phone_norm_start_idx
  on public.appointments (public._norm_phone(customer_phone), start_at)
  where status = 'booked';

create index if not exists appointments_phone_norm_created_idx
  on public.appointments (public._norm_phone(customer_phone), created_at)
  where status = 'booked';

create index if not exists appointments_customer_user_start_idx
  on public.appointments (customer_user_id, start_at)
  where status = 'booked';


-- ---------------------------------------------------------------------
-- 4. visit_id — a multi-service visit needs one identity.
--
-- book_appointment_chain inserts one row per service, each with its own
-- cancel_token. bookAppointmentChain() kept rows[0] and threw the rest
-- away, reasoning that "the rest are reachable from their bookings
-- list" — but list_my_bookings is granted to authenticated only and
-- filters on auth.uid(), and the public booking page requires no
-- account. So a guest who booked three services held ONE link, and
-- cancelling it cancelled ONE appointment. Two staff members kept
-- holding time for a visit the customer believed was cancelled — which
-- is the exact harm 0026 was written to prevent, reproduced on the new
-- feature's happy path.
--
-- NULL means "this row is the whole visit", so every existing row and
-- every single-service booking is correct as-is and no backfill is
-- needed.
-- ---------------------------------------------------------------------
alter table public.appointments add column if not exists visit_id uuid;

create index if not exists appointments_visit_idx
  on public.appointments (visit_id) where visit_id is not null;


-- ---------------------------------------------------------------------
-- 5. The conflict test itself, extracted so both branches above share
--    one definition. Two single-equality EXISTS clauses, each bounded by
--    start_at so section 3's indexes apply; && stays as the residual so
--    the answer is still exact.
--
-- Created AFTER book_appointment references it, which is fine — PL/pgSQL
-- bodies are not resolved until first execution — but declared here in
-- the same migration so the two can never drift apart.
-- ---------------------------------------------------------------------
create or replace function public._customer_busy(
  p_norm_phone text,
  p_start timestamptz,
  p_end timestamptz,
  p_caller_is_staff boolean
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      not p_caller_is_staff
      and auth.uid() is not null
      and exists (
        select 1 from public.appointments a
        where a.customer_user_id = auth.uid()
          and a.status = 'booked'
          and a.start_at >= p_start - interval '1 day'
          and a.start_at <  p_end
          and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start, p_end, '[)')
      )
    )
    or (
      p_norm_phone is not null
      and exists (
        select 1 from public.appointments a
        where public._norm_phone(a.customer_phone) = p_norm_phone
          and a.status = 'booked'
          and a.start_at >= p_start - interval '1 day'
          and a.start_at <  p_end
          and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start, p_end, '[)')
      )
    );
$$;

-- Internal helper. Reached from book_appointment through the owner's
-- privileges, exactly like _resource_slots (0013:337) — no grant, and
-- the revoke that 0026 forgot for _staff_free_for is not forgotten here.
revoke all on function public._customer_busy(text, timestamptz, timestamptz, boolean) from public;


-- ---------------------------------------------------------------------
-- 6. book_appointment — four fixes. Signature unchanged, so grants are
--    preserved and the app's PGRST202 fallback still behaves.
--
-- (a) Business hours were compared with ::time, which discards the date:
--     an appointment ending 02:00 the next day gave 02:00 > 21:00 =
--     false, so it passed. This was unreachable before 0026 because
--     _resource_slots bounds candidates with real timestamp arithmetic,
--     so the UI never offered such a start — but chain segments 2..N are
--     validated only by _staff_free_for, which made it reachable. With
--     the shipped defaults (09:00–21:00, Asia/Amman) a 15-minute consult
--     at 20:45 followed by a long procedure booked a real staff calendar
--     from 21:00 to 02:00, and then silently ate the next morning.
--     Fixed here and in _staff_free_for (section 7); both now compare
--     real instants.
--
--     Note: a clinic whose close is "00:00" now has nothing bookable
--     that day. That already matches _resource_slots (0013:306 computes
--     v_day_end := p_date::timestamp + v_close), so the customer is
--     never offered a slot in the first place. Left consistent rather
--     than fixed in one place only.
--
-- (b) The customer-conflict guard ran BEFORE staff_not_found /
--     outside_business_hours / too_soon. An anonymous caller with a
--     public org slug, a public service id and a bogus p_staff_id got a
--     clean two-valued answer about whether any phone number was busy at
--     any instant, platform-wide, without inserting anything — and so
--     without touching the rate limiter. Moved after the cheap
--     validations in both branches: reaching it now costs a request the
--     clinic would actually accept.
--
-- (c) The guard is split into two single-equality EXISTS clauses and
--     bounded by start_at so the indexes in section 3 can serve it. The
--     && overlap test stays as a residual filter, so the result is
--     still exact. The lower bound must exceed the longest bookable
--     appointment; one day is far beyond any real service.
--
-- (d) The auth.uid() arm matched the CALLER, not the person being
--     booked. On the dashboard auth.uid() is the receptionist, so every
--     manual booking she entered that overlapped her own appointment was
--     flagged — with second-person patient copy — regardless of whose
--     name she typed. It now applies only when the caller is not staff
--     of the org being booked; the phone arm is what covers the front
--     desk, and it still does.
--
-- (e) The rate limiter counted ROWS, so a chain spent one unit per
--     service: segment 7 always raised rate_limited and rolled back the
--     six rows already inserted, telling a customer who made a single
--     request that they were booking too much. Every row written by one
--     transaction shares created_at (transaction_timestamp), so counting
--     distinct created_at counts REQUESTS. A chain of any length costs
--     one; a bot still gets six an hour. Now also keyed on the
--     normalised phone, so spacing the digits no longer resets it.
-- ---------------------------------------------------------------------
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
    and a.status = 'booked'
    and a.created_at > now() - interval '1 hour';
  if v_recent_count >= 6 then
    raise exception 'rate_limited';
  end if;

  select o.id, o.deleted_at into v_org_id, v_org_deleted_at
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
    order by m.created_at
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




-- ---------------------------------------------------------------------
-- 7. _staff_free_for — the same ::time date-loss bug as 5(a). This is
--    the copy that made it reachable, because chain segments 2..N are
--    validated by nothing else. Signature unchanged.
-- ---------------------------------------------------------------------
create or replace function public._staff_free_for(
  p_org_id uuid,
  p_service_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_timezone text,
  p_org_hours jsonb,
  p_staff_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
  v_local_date date;
  v_dow text;
  v_day jsonb;
  v_open time;
  v_close time;
begin
  v_local_date := (p_start at time zone p_timezone)::date;
  v_dow := extract(dow from v_local_date)::int::text;

  for c in
    select m.id, coalesce(m.business_hours, p_org_hours) as hours
    from public.memberships m
    where m.org_id = p_org_id
      and (p_staff_id is null or m.id = p_staff_id)
      and (
        not exists (
          select 1 from public.staff_services ss where ss.service_id = p_service_id
        )
        or exists (
          select 1 from public.staff_services ss
          where ss.service_id = p_service_id and ss.staff_membership_id = m.id
        )
      )
    order by m.created_at
  loop
    v_day := c.hours -> v_dow;
    if v_day is null or (v_day ->> 'closed')::boolean then
      continue;
    end if;

    v_open := (v_day ->> 'open')::time;
    v_close := (v_day ->> 'close')::time;
    -- Real instants, not ::time — an end past midnight used to compare
    -- as 02:00 > 21:00 = false and sail through.
    if p_start < (v_local_date + v_open) at time zone p_timezone
       or p_end > (v_local_date + v_close) at time zone p_timezone then
      continue;
    end if;

    if exists (
      select 1 from public.staff_time_off t
      where t.staff_membership_id = c.id
        and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_start, p_end, '[)')
    ) then
      continue;
    end if;

    if exists (
      select 1 from public.appointments a
      where a.status = 'booked'
        and a.resource_id = c.id
        and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start, p_end, '[)')
    ) then
      continue;
    end if;

    return c.id;
  end loop;

  return null;
end;
$$;

revoke all on function public._staff_free_for(uuid, uuid, timestamptz, timestamptz, text, jsonb, uuid) from public;


-- ---------------------------------------------------------------------
-- 8. book_appointment_chain — stamp every segment with one visit_id, and
--    bound the request. Signature unchanged.
--
-- The cap is not a policy invention: without it the rate limiter (now
-- one unit per request) no longer bounds how much one call can insert,
-- and toggleService in the wizard is an unbounded toggle. Ten is far
-- above any real visit and far below anything worth worrying about.
-- ---------------------------------------------------------------------
create or replace function public.book_appointment_chain(
  p_org_slug text,
  p_service_ids uuid[],
  p_start_at timestamptz,
  p_customer_name text,
  p_customer_phone text,
  p_staff_id uuid default null,
  p_customer_email text default null,
  p_notes text default null,
  p_allow_overlap boolean default false
)
returns table (id uuid, cancel_token uuid, service_id uuid, start_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cursor timestamptz := p_start_at;
  v_service_id uuid;
  v_duration int;
  v_buffer int;
  v_booked record;
  v_visit_id uuid := gen_random_uuid();
  v_count int;
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'no_services';
  end if;

  v_count := array_length(p_service_ids, 1);
  if v_count > 10 then
    raise exception 'too_many_services';
  end if;

  foreach v_service_id in array p_service_ids loop
    select sv.duration_minutes, sv.buffer_minutes
    into v_duration, v_buffer
    from public.services sv
    join public.organizations o on o.id = sv.org_id
    where sv.id = v_service_id and o.slug = p_org_slug and sv.active;

    if v_duration is null then
      raise exception 'service_not_found';
    end if;

    select b.id, b.cancel_token
    into v_booked
    from public.book_appointment(
      p_org_slug, v_service_id, v_cursor,
      p_customer_name, p_customer_phone, p_staff_id,
      p_customer_email, p_notes, p_allow_overlap
    ) b;

    -- Only a real chain gets a visit_id; a single-service call leaves it
    -- NULL, which is what every pre-existing row already means.
    if v_count > 1 then
      update public.appointments a set visit_id = v_visit_id where a.id = v_booked.id;
    end if;

    id := v_booked.id;
    cancel_token := v_booked.cancel_token;
    service_id := v_service_id;
    start_at := v_cursor;
    return next;

    v_cursor := v_cursor + ((v_duration + v_buffer) || ' minutes')::interval;
  end loop;
end;
$$;


-- ---------------------------------------------------------------------
-- 9. get_booking_by_token — return every segment of the visit, not just
--    the row the token belongs to. Same signature and same return type,
--    so this is a body change only; it now returns N rows for a chained
--    visit and exactly one row for everything else.
--
-- getBookingByToken() in src/lib/availability.ts must stop using
-- .maybeSingle() in the same deploy, or the manage page throws for every
-- multi-service visit.
-- ---------------------------------------------------------------------
create or replace function public.get_booking_by_token(p_cancel_token uuid)
returns table (
  id uuid,
  org_name text,
  service_name text,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  customer_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, o.name, sv.name, a.start_at, a.end_at, a.status, a.customer_name
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  join public.services sv on sv.id = a.service_id
  where a.cancel_token = p_cancel_token
     or (
       a.visit_id is not null
       and a.visit_id = (
         select v.visit_id from public.appointments v
         where v.cancel_token = p_cancel_token
       )
     )
  order by a.start_at;
$$;


-- ---------------------------------------------------------------------
-- 10. cancel_visit_by_token — one link cancels the whole visit.
--
-- cancel_booking_by_token is deliberately left alone: /my and the
-- dashboard both need to cancel a single appointment out of a visit.
-- ---------------------------------------------------------------------
create or replace function public.cancel_visit_by_token(p_cancel_token uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.appointments a
  set status = 'cancelled', updated_at = now()
  where a.status = 'booked'
    and (
      a.cancel_token = p_cancel_token
      or (
        a.visit_id is not null
        and a.visit_id = (
          select v.visit_id from public.appointments v
          where v.cancel_token = p_cancel_token
        )
      )
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.cancel_visit_by_token(uuid) from public;
grant execute on function public.cancel_visit_by_token(uuid) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 11. list_public_staff_for_services — staff who can serve the WHOLE
--     visit.
--
-- The wizard built its staff picker from the first service only
-- (BookingClient.tsx:97), reasoning that anyone who cannot start the
-- visit cannot serve it — a correct necessary condition mistaken for a
-- sufficient one. That staff id was then applied to EVERY segment inside
-- get_available_slots_chain, so picking a dentist who does not also do
-- laser produced an empty slot list on every date, indistinguishable
-- from the clinic being closed. It only bit orgs that actually assign
-- services to staff — i.e. exactly the multi-service audience.
--
-- The "a service with no assignment rows constrains nobody" escape hatch
-- from 0023 is preserved deliberately: a plain intersect would hide
-- everyone from an unassigned service.
--
-- An empty result is legitimate — nobody may perform all the selected
-- services — and means the visit gets split across staff, which is
-- allowed. The UI has to say so rather than silently offering nothing.
-- ---------------------------------------------------------------------
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
  where o.slug = p_org_slug and o.deleted_at is null
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

revoke all on function public.list_public_staff_for_services(text, uuid[]) from public;
grant execute on function public.list_public_staff_for_services(text, uuid[]) to anon, authenticated;


-- #####################################################################
-- 0028_close_internal_helpers.sql
-- #####################################################################

-- The revokes in 0013, 0026 and 0027 did not actually close anything.
--
-- Every internal helper in this schema was written as:
--
--   revoke all on function public._helper(...) from public;
--
-- with a comment saying it takes no anon/authenticated grant. That
-- reasoning holds on a stock PostgreSQL, where the only privilege a new
-- function carries is EXECUTE granted to PUBLIC. It does not hold here.
-- supabase/config.toml documents this project as using the legacy
-- behaviour where entities created in `public` are auto-exposed to the
-- Data API roles — which is done by granting EXECUTE to `anon` and
-- `authenticated` DIRECTLY. Revoking from PUBLIC does not touch a grant
-- made to a named role, so all four helpers stayed callable.
--
-- Confirmed against production, as an anonymous caller holding only the
-- publishable key:
--
--   POST /rest/v1/rpc/_staff_free_for   -> 200
--   POST /rest/v1/rpc/_customer_busy    -> 200  false
--   POST /rest/v1/rpc/_norm_phone       -> 200
--   POST /rest/v1/rpc/_resource_slots   -> 200  []
--
-- Nothing else is affected: every owner-facing RPC was probed the same
-- way and each one holds its own line (is_org_owner / is_org_member /
-- auth.uid()), returning not_authorized or an empty set. The helpers are
-- the exception precisely BECAUSE they were believed unreachable, so
-- none of them checks anything.
--
-- Worst of the four is _customer_busy, added in 0027. It answers "does
-- this phone number hold a booking in this window", deliberately across
-- every clinic on the platform, and it takes p_caller_is_staff as an
-- argument — so a caller simply passes false. That is a phone-number
-- oracle: feed it Jordanian mobile numbers and it reports who has an
-- appointment somewhere and when. It was reachable for as long as 0027
-- has been applied.
--
-- _staff_free_for (0026) returns real membership ids and occupancy for
-- an arbitrary window with caller-supplied opening hours, so it bypasses
-- the min-notice and max-advance bounds the public slot RPC enforces.
--
-- _resource_slots (0013) has the same hole and has had it since 0013 was
-- applied. It is the least useful of the three to an attacker — it keeps
-- its own notice/advance bounds internally — but it is the same defect
-- and is closed here too.
--
-- _norm_phone is a pure text function and leaks nothing, but it is
-- closed for consistency: nothing outside the database should be able to
-- call it, and leaving one of the four open invites the next reader to
-- conclude the pattern is optional.
--
-- These functions keep working for the code that actually uses them.
-- get_available_slots, get_available_slots_chain and book_appointment are
-- all SECURITY DEFINER and owned by the same role, so they reach these
-- helpers through ownership, never through a grant.
-- =====================================================================

revoke all on function public._resource_slots(text, jsonb, int, int, int, int, int, date, uuid, uuid)
  from public, anon, authenticated;

revoke all on function public._staff_free_for(uuid, uuid, timestamptz, timestamptz, text, jsonb, uuid)
  from public, anon, authenticated;

revoke all on function public._customer_busy(text, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;

revoke all on function public._norm_phone(text)
  from public, anon, authenticated;


-- Stops the same thing happening to the next helper somebody adds.
-- With this in place a new function in `public` created by this role no
-- longer arrives with EXECUTE already granted to the API roles, so the
-- explicit `grant execute ... to anon, authenticated` that every public
-- RPC in this schema already carries becomes the only way in — which is
-- what the comments throughout these migrations have always claimed.
--
-- Every existing public RPC keeps its grant: default privileges apply
-- only to objects created from here on, never retroactively.
alter default privileges in schema public revoke execute on functions from anon, authenticated;


-- Verify after applying — all four must come back false:
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as auth
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like '\_%'
--   order by p.proname;


-- #####################################################################
-- 0029_notify_clinic.sql
-- #####################################################################

-- Nothing reaches the clinic when a booking arrives or is cancelled.
--
-- sendBookingConfirmation() is the only outbound message in the whole
-- app and it emails the CUSTOMER. The notifications table (0024) has
-- exactly one writer: the account-deletion path. So a centre that signs
-- up, shares its link and starts taking bookings finds out by opening
-- the dashboard and looking — which is the opposite of the promise on
-- /partners ("استقبل حجوزاتك ٢٤ ساعة، بدون مكالمات").
--
-- Two events, two mechanisms, for reasons given at each.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. A new kind. The CHECK admitted only 'booking_cancelled'.
-- ---------------------------------------------------------------------
-- Dropped by what it DOES, not by its name. 0024 wrote the check inline
-- on the column, so its name is whatever PostgreSQL generated; naming it
-- here and guessing wrong would either abort the migration or — worse,
-- with `if exists` — leave the old constraint in place and silently
-- reject every 'booking_created' insert the trigger below makes.
do $do$
declare
  c text;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = 'notifications'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%booking_cancelled%'
  loop
    execute format('alter table public.notifications drop constraint %I', c);
  end loop;
end
$do$;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('booking_created', 'booking_cancelled'));


-- ---------------------------------------------------------------------
-- 2. One notification per appointment per kind, enforced.
--
-- The account-deletion path in 0024 already inserts 'booking_cancelled'
-- rows itself, and section 4 below adds inserts on the customer-facing
-- cancel paths. Those can never both fire for the same row today, but
-- "can never" is exactly the assumption that produced the last three
-- defects in this schema, and a duplicated notification is the kind of
-- thing nobody notices until a clinic complains about double counting.
--
-- Every insert added here is ON CONFLICT DO NOTHING against this index,
-- so whichever writer gets there first wins and the other is a no-op.
-- 0024's own insert is left untouched: it runs inside its own
-- transaction before anything here can race it.
-- ---------------------------------------------------------------------
create unique index if not exists notifications_appointment_kind_idx
  on public.notifications (appointment_id, kind)
  where appointment_id is not null;


-- ---------------------------------------------------------------------
-- 3. New bookings — a trigger, deliberately, and the first one in this
--    schema.
--
-- The alternative is editing book_appointment, which has two separate
-- INSERT sites (explicit staff and any-staff), and doing it again for
-- every future path that creates an appointment. That function is the
-- single most load-bearing thing in the database and this would be its
-- third rewrite in as many migrations; each one has carried a real
-- defect. A trigger states the rule once, cannot be forgotten by the
-- next insert path, and covers book_appointment_chain and the dashboard's
-- manual booking for free.
--
-- Two things it must never do:
--
--   * Fire for a booking the clinic entered itself. Reception typing a
--     phone booking into the dashboard does not need telling about it.
--     Caller is staff of THIS org -> no notification.
--   * Cost anyone a booking. The insert is wrapped, because an AFTER
--     INSERT trigger that raises aborts the transaction that created the
--     appointment — a failed notification would turn into a failed
--     booking, which is far worse than a missing one.
-- ---------------------------------------------------------------------
create or replace function public._notify_booking_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service text;
  v_tz text;
begin
  -- Seeded/backfilled history and anything not actually on the books.
  if new.status <> 'booked' then
    return new;
  end if;

  if auth.uid() is not null and exists (
    select 1 from public.memberships m
    where m.org_id = new.org_id and m.user_id = auth.uid()
  ) then
    return new;
  end if;

  begin
    select sv.name into v_service from public.services sv where sv.id = new.service_id;
    select s.timezone into v_tz from public.org_settings s where s.org_id = new.org_id;

    insert into public.notifications (org_id, kind, title, body, appointment_id)
    values (
      new.org_id,
      'booking_created',
      new.customer_name,
      coalesce(v_service, '') || ' · '
        || to_char(new.start_at at time zone coalesce(v_tz, 'Asia/Amman'), 'YYYY-MM-DD HH24:MI')
        || ' · ' || new.customer_phone,
      new.id
    )
    on conflict do nothing;
  exception when others then
    -- Never let a notification failure roll back the booking itself.
    null;
  end;

  return new;
end;
$$;

revoke all on function public._notify_booking_created() from public, anon, authenticated;

drop trigger if exists appointments_notify_created on public.appointments;
create trigger appointments_notify_created
  after insert on public.appointments
  for each row execute function public._notify_booking_created();


-- The shared body, so the two cancel paths cannot describe the same
-- event differently. Same wrapping as the trigger: a notification must
-- never turn a successful cancellation into a failed one, which would
-- leave the customer believing they still hold the slot.
create or replace function public._notify_booking_cancelled(
  p_appointment_id uuid,
  p_org_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_start_at timestamptz,
  p_service_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service text;
  v_tz text;
begin
  select sv.name into v_service from public.services sv where sv.id = p_service_id;
  select s.timezone into v_tz from public.org_settings s where s.org_id = p_org_id;

  insert into public.notifications (org_id, kind, title, body, appointment_id)
  values (
    p_org_id,
    'booking_cancelled',
    p_customer_name,
    coalesce(v_service, '') || ' · '
      || to_char(p_start_at at time zone coalesce(v_tz, 'Asia/Amman'), 'YYYY-MM-DD HH24:MI')
      || ' · ' || p_customer_phone,
    p_appointment_id
  )
  on conflict do nothing;
exception when others then
  null;
end;
$$;

revoke all on function public._notify_booking_cancelled(uuid, uuid, text, text, timestamptz, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Customer cancellations — explicit, NOT a trigger.
--
-- A trigger on UPDATE would also fire for the clinic cancelling from its
-- own dashboard (setBookingStatus writes the row directly through
-- PostgREST, so there is no function to hang the rule on), and telling a
-- clinic it just cancelled something is noise. These two functions are
-- the customer-facing cancel paths and nothing else reaches them, so the
-- rule is stated where it is true.
--
-- Both keep their existing signature and return type, so they are
-- replaced in place and keep their grants.
-- ---------------------------------------------------------------------
create or replace function public.cancel_booking_by_token(p_cancel_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  -- Counted in the loop, not with GET DIAGNOSTICS afterwards: row_count
  -- would report the last statement executed inside the loop body.
  for r in
    update public.appointments a
    set status = 'cancelled', updated_at = now()
    where a.cancel_token = p_cancel_token and a.status = 'booked'
    returning a.id, a.org_id, a.customer_name, a.customer_phone, a.start_at, a.service_id
  loop
    perform public._notify_booking_cancelled(r.id, r.org_id, r.customer_name, r.customer_phone, r.start_at, r.service_id);
    v_count := v_count + 1;
  end loop;

  return v_count > 0;
end;
$$;

create or replace function public.cancel_visit_by_token(p_cancel_token uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    update public.appointments a
    set status = 'cancelled', updated_at = now()
    where a.status = 'booked'
      and (
        a.cancel_token = p_cancel_token
        or (
          a.visit_id is not null
          and a.visit_id = (
            select v.visit_id from public.appointments v
            where v.cancel_token = p_cancel_token
          )
        )
      )
    returning a.id, a.org_id, a.customer_name, a.customer_phone, a.start_at, a.service_id
  loop
    perform public._notify_booking_cancelled(r.id, r.org_id, r.customer_name, r.customer_phone, r.start_at, r.service_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;




-- Verify after applying:
--
--   select kind, count(*) from public.notifications group by kind;
--
-- and after making one test booking on the public page, the clinic's
-- dashboard should show a 'booking_created' row for it.


-- #####################################################################
-- 0030_reschedule.sql
-- #####################################################################

-- Rescheduling. Until now the only way to move an appointment was to
-- cancel it and book again, which loses the slot in between — if someone
-- else takes it in that gap, the customer wanted 5pm and now has nothing.
--
-- Deliberately an UPDATE in place rather than cancel-and-rebook:
--
--   * the cancel_token is a capability URL that the customer already has
--     in their confirmation email. Rebooking mints a new one and their
--     link 404s.
--   * the appointment id is referenced by reviews.appointment_id (unique,
--     not null) and push_subscriptions.appointment_id. A new row orphans
--     both.
--   * the exclusion constraint does the hard part for free: updating a
--     row does not conflict with its own previous version, so moving
--     3:00-4:00 to 3:30-4:30 is allowed, while overlapping SOMEONE ELSE
--     is rejected at the same isolation guarantee as a fresh booking.
--
-- What this does NOT do: move a whole multi-service visit at once. Each
-- segment moves on its own, which can leave a gap between them. Moving
-- the chain as a unit means re-deriving every segment's offset and
-- re-validating each — worth doing, but it is a separate change and
-- pretending otherwise here would ship a half-version of it.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. A third notification kind. Same name-agnostic drop as 0029 — the
--    constraint added there IS named, but re-deriving it from what it
--    does costs nothing and survives someone renaming it.
-- ---------------------------------------------------------------------
do $do$
declare
  c text;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = 'notifications'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%booking_cancelled%'
  loop
    execute format('alter table public.notifications drop constraint %I', c);
  end loop;
end
$do$;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('booking_created', 'booking_cancelled', 'booking_rescheduled'));


-- ---------------------------------------------------------------------
-- 2. The core. Both entry points below funnel through this, so a clinic
--    moving an appointment and a customer moving the same appointment
--    are validated identically.
--
-- Booking CONFLICTS are not checked here on purpose — the exclusion
-- constraint is the only correct place for that, because a check-then-
-- write in application code loses to a simultaneous request. Everything
-- this validates is the part a constraint cannot express: opening hours,
-- time off, notice and how far ahead bookings are allowed.
-- ---------------------------------------------------------------------
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

  if exists (select 1 from public.organizations o where o.id = a.org_id and o.deleted_at is not null) then
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

revoke all on function public._reschedule(uuid, timestamptz) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. The customer's way in: the cancel token they already hold.
--
-- Named for what it does to a booking, not for the token — the token is
-- simply the capability that proves this is their appointment, exactly
-- as it does for get_booking_by_token and cancel_booking_by_token.
-- ---------------------------------------------------------------------
create or replace function public.reschedule_booking_by_token(
  p_cancel_token uuid,
  p_start_at timestamptz
)
returns table (id uuid, start_at timestamptz, end_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select ap.id into v_id from public.appointments ap where ap.cancel_token = p_cancel_token;
  if v_id is null then
    raise exception 'booking_not_found';
  end if;
  return query select * from public._reschedule(v_id, p_start_at);
end;
$$;

revoke all on function public.reschedule_booking_by_token(uuid, timestamptz) from public;
grant execute on function public.reschedule_booking_by_token(uuid, timestamptz) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. The clinic's way in. Reception takes the "can I move it to five?"
--    call far more often than the customer opens their own link, so this
--    is the path that actually gets used.
--
-- is_org_member, not is_org_owner: whoever answers the phone is usually
-- not the owner, and they can already cancel from the dashboard — being
-- allowed to destroy an appointment but not move it would be perverse.
-- ---------------------------------------------------------------------
create or replace function public.reschedule_booking(
  p_appointment_id uuid,
  p_start_at timestamptz
)
returns table (id uuid, start_at timestamptz, end_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select ap.org_id into v_org_id from public.appointments ap where ap.id = p_appointment_id;
  if v_org_id is null then
    raise exception 'booking_not_found';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not_authorized';
  end if;
  return query select * from public._reschedule(p_appointment_id, p_start_at);
end;
$$;

revoke all on function public.reschedule_booking(uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_booking(uuid, timestamptz) to authenticated;


-- ---------------------------------------------------------------------
-- 5. get_booking_by_token, widened so the manage page can offer a slot
--    picker.
--
-- It returned service NAME but not service id, org slug or staff id — so
-- the page could say what was booked but had no way to ask what else is
-- available. Rather than adding a near-duplicate of get_available_slots
-- that resolves those internally, the three ids are exposed and the page
-- calls the SAME slot RPC the customer used when booking. One source of
-- truth for what "available" means.
--
-- Return type changes, so this is DROP + CREATE, and the grants 0004
-- gave it must be restated — the lesson from 0024, where a DROP silently
-- discarded them.
--
-- One known limitation, stated rather than hidden: the slot list treats
-- the appointment's own current window as occupied, because it is. So a
-- customer moving a 60-minute booking from 3:00 to 3:15 will not be
-- offered 3:15. Moving it somewhere genuinely different — which is what
-- rescheduling is for — is unaffected. Fixing it properly needs an
-- "ignore this appointment" parameter threaded through _resource_slots,
-- which is a change to the booking read path and does not belong in the
-- same migration as the write path.
-- ---------------------------------------------------------------------
drop function public.get_booking_by_token(uuid);

create function public.get_booking_by_token(p_cancel_token uuid)
returns table (
  id uuid,
  org_name text,
  org_slug text,
  service_name text,
  service_id uuid,
  staff_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  customer_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, o.name, o.slug, sv.name, a.service_id, a.staff_id,
         a.start_at, a.end_at, a.status, a.customer_name
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  join public.services sv on sv.id = a.service_id
  where a.cancel_token = p_cancel_token
     or (
       a.visit_id is not null
       and a.visit_id = (
         select v.visit_id from public.appointments v
         where v.cancel_token = p_cancel_token
       )
     )
  order by a.start_at;
$$;

revoke all on function public.get_booking_by_token(uuid) from public;
grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;

