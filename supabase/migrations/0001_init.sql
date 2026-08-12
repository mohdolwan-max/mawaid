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
