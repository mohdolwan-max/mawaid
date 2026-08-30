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
  select m.id, nullif(trim(coalesce(m.display_name, '')), '')
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where o.slug = p_org_slug and o.deleted_at is null
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
