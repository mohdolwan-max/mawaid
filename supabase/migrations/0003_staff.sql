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
