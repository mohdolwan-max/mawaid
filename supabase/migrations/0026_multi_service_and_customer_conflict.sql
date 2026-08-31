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
