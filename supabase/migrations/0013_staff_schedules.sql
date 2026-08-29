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
