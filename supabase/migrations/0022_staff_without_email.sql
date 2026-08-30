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
