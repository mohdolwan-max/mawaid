-- Branches (owner, 2026-10-25, item 11 of the roadmap: "الفروع"). Owner's
-- decision: every branch is a complete clinic (its own page and link,
-- specialists, services, hours, settings and subscription) under one
-- owner account, which switches between them.
--
-- Decided here, and why:
--   * One account may now hold several clinics, and each member has an
--     ACTIVE one (active_orgs). Every function that used to take "the
--     caller's clinic" as their first membership (eight of them, each with
--     a limit 1) now takes the active one through _active_org(), so the
--     whole dashboard follows the switch and nothing in it can reach a
--     clinic the user is not working in at that moment.
--   * No active choice yet (everyone today): the first membership, owner
--     first, oldest first, exactly as before. A choice that no longer
--     holds (the membership is gone) falls back the same way.
--   * A new branch is made by the owner of the clinic it starts from and
--     may copy its settings (hours, booking rules, timezone), its public
--     profile (category, city, logo, cover, description) and its services.
--     Never specialists, bookings, customers or money: those belong to
--     each branch. It gets its own trial and subscription, like any clinic
--     (no branch pricing was decided).
--   * branches_summary gives the owner one line per clinic they own, for
--     the period, valued as the report values visits (_visit_values).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The active clinic.
-- ---------------------------------------------------------------------
create table if not exists public.active_orgs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.active_orgs enable row level security;
revoke all on public.active_orgs from anon, authenticated;

create or replace function public._active_org()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select a.org_id
       from public.active_orgs a
       join public.memberships m on m.org_id = a.org_id and m.user_id = a.user_id
      where a.user_id = auth.uid()),
    (select m.org_id
       from public.memberships m
      where m.user_id = auth.uid()
      order by (m.role = 'owner') desc, m.created_at
      limit 1));
$$;

revoke all on function public._active_org() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Every "the caller's clinic" now means the active one.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._my_member()
 RETURNS TABLE(org_id uuid, membership_id uuid, role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.org_id, m.id, m.role
  from public.memberships m
  where m.user_id = auth.uid() and m.org_id = public._active_org()
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public._my_owner_org()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select m.org_id
  from public.memberships m
  where m.user_id = auth.uid() and m.role = 'owner' and m.org_id = public._active_org()
  limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.add_staff_member(p_name text, p_title text DEFAULT NULL::text, p_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
  v_id uuid;
begin
  select org_id into v_org_id
  from public.memberships
  where user_id = auth.uid() and role = 'owner' and org_id = public._active_org()
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
$function$;

CREATE OR REPLACE FUNCTION public.close_organization()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
  from public.memberships
  where user_id = auth.uid() and role = 'owner' and org_id = public._active_org()
  limit 1;

  if v_org_id is null then
    raise exception 'not_authorized';
  end if;

  update public.organizations set deleted_at = now() where id = v_org_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_context()
 RETURNS TABLE(org_id uuid, org_name text, org_slug text, org_address text, org_phone text, org_logo_url text, lang text, timezone text, business_hours jsonb, slot_interval_minutes integer, min_notice_minutes integer, max_advance_days integer, wizard_done boolean, role text, deleted_at timestamp with time zone, country text, currency text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- 0071: the clinic the user is working in (their branches switch it).
  select m.org_id, m.role into v_org_id, v_role
  from public.memberships m
  where m.user_id = auth.uid() and m.org_id = public._active_org()
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
$function$;

CREATE OR REPLACE FUNCTION public.mark_notifications_read()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
  from public.memberships where user_id = auth.uid() and org_id = public._active_org() limit 1;

  if v_org_id is null then
    raise exception 'not_authorized';
  end if;

  update public.notifications
  set read_at = now()
  where org_id = v_org_id and read_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.my_plan_usage()
 RETURNS TABLE(plan_id text, is_trial boolean, expires_at timestamp with time zone, open_until timestamp with time zone, phase text, seats_used integer, max_staff integer, sms_per_month integer, featured boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_org uuid;
begin
  select m.org_id into v_org
  from public.memberships m
  where m.user_id = auth.uid() and m.org_id = public._active_org()
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
$function$;

CREATE OR REPLACE FUNCTION public.my_sms_usage()
 RETURNS TABLE(used_this_month integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_org uuid;
  v_tz text;
begin
  select m.org_id into v_org
  from public.memberships m
  where m.user_id = auth.uid() and m.org_id = public._active_org()
  limit 1;

  if v_org is null then
    raise exception 'not_authorized';
  end if;

  -- The clinic's own clock (org_settings), else its country's (0056).
  select coalesce(
           (select s.timezone from public.org_settings s where s.org_id = v_org),
           (select m.timezone from public.organizations o join public.markets m on m.code = o.country where o.id = v_org),
           'Asia/Amman'
         )
    into v_tz;

  return query
    select count(*)::int
    from public.sms_messages s
    where s.org_id = v_org
      and s.sent_at >= (date_trunc('month', now() at time zone v_tz) at time zone v_tz);
end;
$function$;


-- ---------------------------------------------------------------------
-- 3. The user's clinics, and switching.
-- ---------------------------------------------------------------------
drop function if exists public.my_orgs();
create function public.my_orgs()
returns table (org_id uuid, name text, slug text, role text, city text, is_active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.slug, m.role, o.city, o.id = public._active_org()
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid() and o.deleted_at is null
  order by (m.role = 'owner') desc, o.created_at;
$$;

revoke all on function public.my_orgs() from public, anon;
grant execute on function public.my_orgs() to authenticated;

drop function if exists public.set_active_org(uuid);
create function public.set_active_org(p_org_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not exists (select 1 from public.memberships m
                    join public.organizations o on o.id = m.org_id
                    where m.user_id = auth.uid() and m.org_id = p_org_id and o.deleted_at is null) then
    raise exception 'not_authorized';
  end if;
  insert into public.active_orgs (user_id, org_id, updated_at)
  values (auth.uid(), p_org_id, now())
  on conflict (user_id) do update set org_id = excluded.org_id, updated_at = now();
  return true;
end;
$$;

revoke all on function public.set_active_org(uuid) from public, anon;
grant execute on function public.set_active_org(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 4. A new branch, copied from a clinic the caller owns. Returns its id
--    and makes it the active clinic.
-- ---------------------------------------------------------------------
drop function if exists public.create_branch(text, text, uuid, boolean);
create function public.create_branch(p_name text, p_slug text, p_from_org uuid, p_copy_services boolean default true)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_src public.organizations%rowtype;
  v_new uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authorized';
  end if;
  select o.* into v_src from public.organizations o
  where o.id = p_from_org and o.deleted_at is null
    and exists (select 1 from public.memberships m
                where m.org_id = o.id and m.user_id = auth.uid() and m.role = 'owner');
  if v_src.id is null then
    raise exception 'not_authorized';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 then
    raise exception 'branch_name';
  end if;

  -- Slug rules, reserved names and the market check are create_organization's.
  v_new := public.create_organization(btrim(p_name), p_slug, v_src.country);

  update public.organizations o
     set category = v_src.category, city = v_src.city, logo_url = v_src.logo_url,
         cover_image_url = v_src.cover_image_url, description = v_src.description,
         price_tier = v_src.price_tier, is_listed = v_src.is_listed
   where o.id = v_new;

  update public.org_settings s
     set lang = src.lang, timezone = src.timezone, business_hours = src.business_hours,
         slot_interval_minutes = src.slot_interval_minutes, min_notice_minutes = src.min_notice_minutes,
         max_advance_days = src.max_advance_days, compact_slots = src.compact_slots,
         wizard_done = src.wizard_done, updated_at = now()
    from public.org_settings src
   where s.org_id = v_new and src.org_id = v_src.id;

  if coalesce(p_copy_services, false) then
    insert into public.services (org_id, name, duration_minutes, buffer_minutes, price, active, sort_order, photo_url)
    select v_new, sv.name, sv.duration_minutes, sv.buffer_minutes, sv.price, sv.active, sv.sort_order, sv.photo_url
    from public.services sv
    where sv.org_id = v_src.id;
  end if;

  insert into public.active_orgs (user_id, org_id, updated_at)
  values (auth.uid(), v_new, now())
  on conflict (user_id) do update set org_id = excluded.org_id, updated_at = now();
  return v_new;
end;
$$;

revoke all on function public.create_branch(text, text, uuid, boolean) from public, anon;
grant execute on function public.create_branch(text, text, uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 5. One line per clinic the caller owns, for a period (each clinic's
--    own timezone decides its days).
-- ---------------------------------------------------------------------
drop function if exists public.branches_summary(date, date);
create function public.branches_summary(p_from date, p_to date)
returns table (
  org_id uuid,
  name text,
  slug text,
  currency text,
  visits int,
  completed int,
  no_shows int,
  value numeric,
  unpriced int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not_authorized';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'report_bad_period';
  end if;
  -- Per clinic, one pass: _visit_values runs once for each clinic, not
  -- once for each appointment.
  return query
    select o.id, o.name, o.slug, mk.currency,
           x.visits, x.completed, x.no_shows, x.value, x.unpriced
    from public.memberships m
    join public.organizations o on o.id = m.org_id and o.deleted_at is null
    join public.markets mk on mk.code = o.country
    cross join lateral (
      select count(a.id)::int as visits,
             count(a.id) filter (where a.status = 'completed')::int as completed,
             count(a.id) filter (where a.status = 'no_show')::int as no_shows,
             coalesce(sum(vv.value) filter (where a.status = 'completed'), 0) as value,
             count(a.id) filter (where a.status = 'completed' and vv.value is null)::int as unpriced
      from public.appointments a
      join public._visit_values(o.id) vv on vv.appointment_id = a.id
      where a.org_id = o.id
        and a.start_at >= (p_from::timestamp at time zone public._org_tz(o.id))
        and a.start_at < ((p_to + 1)::timestamp at time zone public._org_tz(o.id))
    ) x
    where m.user_id = auth.uid() and m.role = 'owner'
    order by o.created_at;
end;
$$;

revoke all on function public.branches_summary(date, date) from public, anon;
grant execute on function public.branches_summary(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select has_table_privilege('authenticated', 'public.active_orgs', 'select');   -- false
-- select has_function_privilege('anon', 'public.create_branch(text,text,uuid,boolean)', 'execute');   -- false
