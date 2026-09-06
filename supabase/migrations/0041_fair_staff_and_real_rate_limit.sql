-- Two defects in book_appointment, both found by live testing rather
-- than by reading: the rate limit could be reset for ever, and "any
-- available staff" was not distributing anything.
--
-- (1) THE LIMIT WAS RESETTABLE. It counted only rows still status
--     ='booked', so book-then-cancel-then-book restored the full
--     allowance on the same number, indefinitely. Slots were not the
--     casualty — cancelling frees those — the clinic's NOTIFICATIONS
--     were: 0029 raises one per booking, so the loop is a notification
--     flood aimed at the owner's dashboard. Now every request inside
--     the window counts, whatever became of it.
--
-- (2) "ANY STAFF" ALWAYS PICKED THE SAME PERSON. Candidates were tried
--     'order by m.created_at' — the first membership an org has is its
--     owner — so with no clashes to force a fallthrough, every such
--     booking went to one person. Verified live: five bookings at
--     spaced times, all in one column, the rest of the roster empty.
--     A salon with three stylists would have filled the first one's day
--     and left two idle. Now the least-loaded eligible member for that
--     DATE goes first, so the spread happens with nothing for the
--     clinic to configure.
--
-- Eligibility is deliberately NOT touched. When a service has no
-- staff_services rows every member qualifies, owner included, and that
-- is correct: a solo clinic's owner IS the practitioner, and excluding
-- them would leave nobody to book.
--
-- Signature and return type are unchanged, so CREATE OR REPLACE keeps
-- the existing grants — nothing to restate.
-- =====================================================================

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
    -- Every request in the window counts, whatever became of the
    -- booking afterwards. Counting only status='booked' meant a
    -- book/cancel loop reset the allowance for ever on one number,
    -- and every one of those bookings had already fired a
    -- notification at the clinic (0029) — the real cost of the loop.
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
    -- Least loaded first, not oldest first. order by m.created_at
    -- always tried the same person — in practice the owner, the
    -- first membership an org gets — so every "any staff" booking
    -- landed on them while the rest of the roster sat empty
    -- (observed live: five spaced bookings, one column). Cancelled
    -- appointments are excluded here on purpose: they no longer
    -- occupy anyone's day, so they must not count as load.
    order by (
      select count(*)
      from public.appointments a
      where a.staff_id = m.id
        and a.status = 'booked'
        and (a.start_at at time zone v_timezone)::date = v_local_date
    ), m.created_at
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
-- Verify after applying.
--
-- (1) The limit no longer resets. Book six on one number, cancel them
--     all, then try a seventh — it must still be refused:
--
--     update public.appointments set status = 'cancelled'
--      where public._norm_phone(customer_phone) = '0791110000'
--        and created_at > now() - interval '1 hour';
--     -- then book again on 0791110000 -> expect rate_limited
--
-- (2) "Any staff" spreads. On a clinic with two or more staff eligible
--     for one service, book several NON-overlapping times as "any
--     staff" (p_staff_id => null) and the rows must name different
--     people — before this they all named the same one:
--
--     select a.start_at, m.display_name
--     from public.appointments a
--     join public.memberships m on m.id = a.staff_id
--     where a.org_id = (select id from public.organizations where slug = 'demo-nabd-derma')
--       and a.created_at > now() - interval '10 minutes'
--     order by a.start_at;
