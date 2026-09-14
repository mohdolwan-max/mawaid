-- Plans: free / basic / pro. One table holds every plan NUMBER — price,
-- staff limit, SMS allowance, directory featuring — and the pricing page,
-- the dashboard and the enforcement below all read it. A price change
-- later is one UPDATE, not a redeploy, and no two screens can disagree
-- (ENGINEERING-STANDARDS §1: one number, one source).
--
-- Owner's decisions, 2026-09: three tiers; basic 19 JOD, pro 39 JOD a
-- month; basic up to 5 staff; SMS 200 / 1000 a month; yearly = two months
-- free.
--
-- Not wired, and named so nobody mistakes it for done:
--   * payments — a plan is assigned by hand with set_org_plan() below;
--   * the SMS allowance is stored for display only. Nothing sends SMS
--     yet; the pricing page marks it "soon" until OTP lands.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The table, seeded with the owner's numbers.
-- ---------------------------------------------------------------------
create table if not exists public.plans (
  id text primary key,
  sort int not null,
  max_staff int,                -- null = unlimited
  sms_per_month int not null,
  price_month_jod numeric(7,2) not null,
  price_year_jod numeric(8,2) not null,
  featured boolean not null default false,
  constraint plans_max_staff_positive check (max_staff is null or max_staff >= 1),
  constraint plans_prices_nonneg check (price_month_jod >= 0 and price_year_jod >= 0)
);

-- Read only through list_plans() / my_plan_usage(); nothing queries it.
alter table public.plans enable row level security;
revoke all on public.plans from anon, authenticated;

-- DO NOTHING on conflict: re-running this file must never overwrite a
-- price the owner has since changed by hand.
insert into public.plans (id, sort, max_staff, sms_per_month, price_month_jod, price_year_jod, featured) values
  ('free',  1, 1,    0,    0,  0,   false),
  ('basic', 2, 5,    200,  19, 190, false),
  ('pro',   3, null, 1000, 39, 390, true)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 2. organizations.plan follows the table instead of a hard-coded list.
--
-- The old CHECK allowed ('free','pro','business'). Nothing was ever sold
-- and nothing was gated on it, so the mapping only has to preserve tier
-- POSITION: old middle 'pro' becomes 'basic', old top 'business' becomes
-- 'pro'. One CASE, so each row is mapped once from its original value.
-- The CHECK is found by its definition, not a guessed name.
-- ---------------------------------------------------------------------
do $do$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.organizations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%plan = ANY%'
  loop
    execute format('alter table public.organizations drop constraint %I', r.conname);
  end loop;
end
$do$;

update public.organizations
   set plan = case plan when 'pro' then 'basic' when 'business' then 'pro' else plan end
 where plan in ('pro', 'business');

update public.organizations
   set plan = 'free'
 where plan not in (select id from public.plans);

-- The demo clinics carry two staff each, which the free plan (one) would
-- refuse — re-running supabase/seed/demo_clinics.sql would then fail on
-- its second staff row. Basic fits them and does not feature them.
update public.organizations
   set plan = 'basic'
 where slug like 'demo-%' and plan = 'free';

alter table public.organizations drop constraint if exists organizations_plan_fkey;
alter table public.organizations
  add constraint organizations_plan_fkey foreign key (plan) references public.plans (id);


-- ---------------------------------------------------------------------
-- 3. Helpers. Internal: no session role may call them directly.
-- ---------------------------------------------------------------------

-- The plan that actually applies: a paid plan past its expiry is free.
create or replace function public.org_effective_plan(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
           when o.plan_expires_at is not null and o.plan_expires_at <= now() then 'free'
           else o.plan
         end
  from public.organizations o
  where o.id = p_org_id;
$$;

-- Seats taken = staff rows + invitations still holding a seat. A pending
-- invitation holds one from the moment it is sent — otherwise an org at
-- 4 of 5 could send three invites and end at 7. Not counted: linked
-- invites (they adopt a staff row already counted) and invites whose
-- address already belongs to a member (a re-invite reset to pending).
create or replace function public._org_seats_used(p_org_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.memberships m where m.org_id = p_org_id)::int
    +
    (select count(*)
       from public.invitations i
      where i.org_id = p_org_id
        and i.accepted_at is null
        and i.membership_id is null
        and not exists (
          select 1
          from public.memberships m
          join auth.users u on u.id = m.user_id
          where m.org_id = p_org_id and lower(u.email) = i.email
        ))::int;
$$;

revoke all on function public.org_effective_plan(uuid) from public, anon, authenticated;
revoke all on function public._org_seats_used(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Enforcement, as triggers — every path that adds a person, including
--    ones not written yet.
--
-- Today three definer functions insert memberships (create_organization,
-- add_staff_member, get_my_context's invite acceptance) and one inserts
-- invitations (invite_staff). No session can insert either table
-- directly. A trigger covers all of them, and whatever comes next.
--
-- THE ONE THING THAT MUST NEVER HAPPEN: get_my_context is the app's login
-- bootstrap (0022 says so in as many words), and it inserts the
-- membership when someone accepts an invite. A limit raised there would
-- lock that person out of their account. So a person adding THEMSELVES is
-- exempt — the seat was held by their invitation when it was sent, which
-- is where the limit bites instead. The other self-insert is
-- create_organization making the owner of a brand-new org, which could
-- never exceed a limit anyway.
--
-- Accepted consequence: an org downgraded while invites were pending can
-- end a seat or two over its limit when they are accepted. Honouring an
-- invite the owner already sent beats breaking a login; no NEW staff can
-- be added until the org is back under.
-- ---------------------------------------------------------------------
create or replace function public._enforce_plan_seats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int;
begin
  if tg_table_name = 'memberships' then
    if new.user_id is not null and new.user_id = auth.uid() then
      return new;
    end if;
  elsif tg_table_name = 'invitations' then
    -- Linked invite: adopts an already-counted staff row. Same address
    -- already invited: invite_staff's ON CONFLICT turns this into an
    -- update of that row, but BEFORE INSERT fires first regardless.
    if new.membership_id is not null or exists (
      select 1 from public.invitations i
      where i.org_id = new.org_id and i.email = new.email
    ) then
      return new;
    end if;
  end if;

  -- Serialise seat changes per org, so two simultaneous additions cannot
  -- both read "4 of 5" and land a sixth. Taken only on the enforced path,
  -- so the exempt login path above never waits on it.
  perform 1 from public.organizations where id = new.org_id for update;

  select p.max_staff into v_max
  from public.plans p
  where p.id = public.org_effective_plan(new.org_id);

  -- null = unlimited, or an org that does not resolve (the foreign key on
  -- org_id refuses that row on its own).
  if v_max is null then
    return new;
  end if;

  if public._org_seats_used(new.org_id) >= v_max then
    raise exception 'plan_staff_limit';
  end if;

  return new;
end;
$$;

revoke all on function public._enforce_plan_seats() from public, anon, authenticated;

drop trigger if exists enforce_plan_seats on public.memberships;
create trigger enforce_plan_seats
  before insert on public.memberships
  for each row execute function public._enforce_plan_seats();

drop trigger if exists enforce_plan_seats on public.invitations;
create trigger enforce_plan_seats
  before insert on public.invitations
  for each row execute function public._enforce_plan_seats();


-- ---------------------------------------------------------------------
-- 5. What the app reads.
-- ---------------------------------------------------------------------

-- Public: the pricing page.
drop function if exists public.list_plans();
create function public.list_plans()
returns table (
  id text,
  sort int,
  max_staff int,
  sms_per_month int,
  price_month_jod numeric,
  price_year_jod numeric,
  featured boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select id, sort, max_staff, sms_per_month, price_month_jod, price_year_jod, featured
  from public.plans
  order by sort;
$$;

revoke all on function public.list_plans() from public, anon, authenticated;
grant execute on function public.list_plans() to anon, authenticated;

-- Signed-in member: their own org's plan and seat usage, for the dashboard.
drop function if exists public.my_plan_usage();
create function public.my_plan_usage()
returns table (
  plan_id text,
  stored_plan_id text,
  expires_at timestamptz,
  expired boolean,
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
  v_effective text;
begin
  select m.org_id into v_org
  from public.memberships m
  where m.user_id = auth.uid()
  limit 1;

  if v_org is null then
    raise exception 'not_authorized';
  end if;

  v_effective := public.org_effective_plan(v_org);

  return query
    select v_effective,
           o.plan,
           o.plan_expires_at,
           (o.plan_expires_at is not null and o.plan_expires_at <= now()),
           public._org_seats_used(v_org),
           p.max_staff,
           p.sms_per_month,
           p.featured
    from public.organizations o
    join public.plans p on p.id = v_effective
    where o.id = v_org;
end;
$$;

revoke all on function public.my_plan_usage() from public, anon, authenticated;
grant execute on function public.my_plan_usage() to authenticated;


-- ---------------------------------------------------------------------
-- 6. Assigning a plan, until payments exist. Deliberately granted to
--    NOBODY: callable only from the SQL editor. Downgrading never removes
--    staff — the trigger only refuses additions.
--
--    select public.set_org_plan('moon', 'basic');                       -- no expiry
--    select public.set_org_plan('moon', 'pro', now() + interval '1 month');
-- ---------------------------------------------------------------------
drop function if exists public.set_org_plan(text, text, timestamptz);
create function public.set_org_plan(
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
         plan_expires_at = p_expires_at
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


-- ---------------------------------------------------------------------
-- Verify after applying.
-- ---------------------------------------------------------------------
-- select * from public.list_plans();          -- 3 rows: free 0/1, basic 19/5, pro 39/null
--
-- select slug, plan from public.organizations order by slug;   -- demo-* on basic
--
-- The limit bites (inside a transaction, rolled back — nothing is kept):
-- begin;
--   insert into public.memberships (org_id, role, display_name)
--   select id, 'staff', 'limit test' from public.organizations where slug = 'moon';
--   -- expect: ERROR plan_staff_limit (moon is free; its owner holds the one seat)
-- rollback;
