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
