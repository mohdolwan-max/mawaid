-- Rooms and devices (owner, 2026-10-25, item 8 of the roadmap: "الغرف
-- والأجهزة"). Two specialists cannot both use the clinic's one laser
-- machine at three o'clock, however free each of them is.
--
-- Decided here, and why:
--   * A room or device has a capacity: how many visits it can hold at once.
--     Two identical laser rooms are one entry with capacity 2, so "any
--     free one of them" needs no extra rule.
--   * A service needs zero or more of them; it is offered at a time only
--     when every one it needs has room then. A service that needs none is
--     exactly as before, so nothing changes for a clinic until it adds one.
--   * Counted from booked appointments only (a cancelled, completed or
--     missed visit holds nothing), over the same span the diary already
--     uses (duration plus buffer), and by the service's needs as they are
--     now: changing what a service needs applies to its existing bookings.
--   * Offered times are filtered (get_available_slots, the chain), and the
--     booking and the move check again under a row lock on the rooms and
--     devices, so two simultaneous bookings for the last free one cannot
--     both succeed ('resource_busy').
--   * The clinic's owner manages them; every member reads them. The tables
--     have no grants; everything goes through the functions below.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null default 'device',
  capacity int not null default 1,
  created_at timestamptz not null default now(),
  constraint resources_id_org_key unique (id, org_id),
  constraint resources_name check (char_length(btrim(name)) between 1 and 60),
  constraint resources_kind check (kind in ('room', 'device')),
  constraint resources_capacity check (capacity between 1 and 20)
);

create table if not exists public.service_resources (
  service_id uuid not null,
  resource_id uuid not null,
  org_id uuid not null,
  primary key (service_id, resource_id),
  constraint service_resources_service_same_org foreign key (service_id, org_id)
    references public.services (id, org_id) on delete cascade,
  constraint service_resources_resource_same_org foreign key (resource_id, org_id)
    references public.resources (id, org_id) on delete cascade
);

create index if not exists service_resources_resource on public.service_resources (resource_id);

alter table public.resources enable row level security;
alter table public.service_resources enable row level security;
revoke all on public.resources from anon, authenticated;
revoke all on public.service_resources from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Is there room? True when every room and device the service needs
--    holds fewer booked visits over [p_start, p_end) than its capacity.
--    p_ignore leaves out one appointment (the one being moved).
-- ---------------------------------------------------------------------
create or replace function public._resources_free(p_org uuid, p_service uuid, p_start timestamptz, p_end timestamptz, p_ignore uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.service_resources sr
    join public.resources r on r.id = sr.resource_id
    where sr.service_id = p_service
      and (
        select count(*)
        from public.appointments a
        join public.service_resources sr2 on sr2.service_id = a.service_id and sr2.resource_id = r.id
        where a.org_id = p_org
          and a.status = 'booked'
          and a.start_at < p_end and a.end_at > p_start
          and (p_ignore is null or a.id <> p_ignore)
      ) >= r.capacity
  );
$$;

revoke all on function public._resources_free(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Offered times, booking and moving honour them.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_available_slots(p_org_slug text, p_service_id uuid, p_date date, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(start_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_compact boolean;
begin
  select o.id, case when public._org_closed(o.deleted_at, o.plan_expires_at) then coalesce(o.deleted_at, now()) end into v_org_id, v_org_deleted_at
  from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null or v_org_deleted_at is not null then
    return;
  end if;

  select s.timezone, s.business_hours, s.slot_interval_minutes, s.min_notice_minutes, s.max_advance_days,
         coalesce(s.compact_slots, false)
  into v_timezone, v_org_hours, v_slot_interval_minutes, v_min_notice_minutes, v_max_advance_days, v_compact
  from public.org_settings s where s.org_id = v_org_id;
  -- 0067: the clinic itself may look up to a year ahead.
  v_max_advance_days := public._caller_window(v_org_id, v_max_advance_days);
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

    -- 0068: only where the rooms and devices the service needs are free.
    return query
      select rs.start_at from public._resource_slots(
        v_timezone, v_staff_hours, v_slot_interval_minutes, v_min_notice_minutes, v_max_advance_days,
        v_duration_minutes, v_buffer_minutes, p_date, p_staff_id, p_staff_id, v_compact
      ) rs
      where public._resources_free(v_org_id, p_service_id, rs.start_at, rs.start_at + ((v_duration_minutes + v_buffer_minutes) || ' minutes')::interval, null);
    return;
  end if;

  -- "Any available staff": union every eligible staff member's slots.
  return query
    select distinct rs.start_at
    from public.memberships m
    cross join lateral public._resource_slots(
      v_timezone, coalesce(m.business_hours, v_org_hours), v_slot_interval_minutes, v_min_notice_minutes,
      v_max_advance_days, v_duration_minutes, v_buffer_minutes, p_date, m.id, m.id, v_compact
    ) rs
    where m.org_id = v_org_id
      and (
        not exists (select 1 from public.staff_services ss where ss.service_id = p_service_id)
        or exists (select 1 from public.staff_services ss where ss.service_id = p_service_id and ss.staff_membership_id = m.id)
      )
      -- 0068: and the rooms and devices the service needs are free.
      and public._resources_free(v_org_id, p_service_id, rs.start_at, rs.start_at + ((v_duration_minutes + v_buffer_minutes) || ' minutes')::interval, null)
    order by rs.start_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_available_slots_chain(p_org_slug text, p_service_ids uuid[], p_date date, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(start_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  where o.slug = p_org_slug and not public._org_closed(o.deleted_at, o.plan_expires_at);

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
      -- 0068: each service's rooms and devices, at its own time.
      if not public._resources_free(
           v_org_id, v_service_id, v_cursor,
           v_cursor + ((v_duration + v_buffer) || ' minutes')::interval, null) then
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
$function$;

CREATE OR REPLACE FUNCTION public._book_one(p_org_slug text, p_service_id uuid, p_start_at timestamp with time zone, p_customer_name text, p_customer_phone text, p_staff_id uuid DEFAULT NULL::uuid, p_customer_email text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_allow_overlap boolean DEFAULT false)
 RETURNS TABLE(id uuid, cancel_token uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_slot_interval int;
  v_local_minutes int;
  v_compact boolean;
begin
  if trim(p_customer_name) = '' or trim(p_customer_phone) = '' then
    raise exception 'missing_contact_info';
  end if;
  -- 0051: the name goes into the clinic's notification title and the
  -- confirmation email, and had no limit anywhere — not in the client,
  -- the action or the column.
  if char_length(trim(p_customer_name)) > 80 then
    raise exception 'name_too_long';
  end if;
  if char_length(coalesce(p_notes, '')) > 500 then
    raise exception 'notes_too_long';
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

  select o.id, case when public._org_closed(o.deleted_at, o.plan_expires_at) then coalesce(o.deleted_at, now()) end into v_org_id, v_org_deleted_at
  from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null or v_org_deleted_at is not null then
    raise exception 'org_not_found';
  end if;

  select s.timezone, s.business_hours, s.min_notice_minutes, s.max_advance_days,
         coalesce(s.slot_interval_minutes, 15), coalesce(s.compact_slots, false)
  into v_timezone, v_org_hours, v_min_notice_minutes, v_max_advance_days, v_slot_interval, v_compact
  from public.org_settings s where s.org_id = v_org_id;
  -- 0067: the clinic itself may book up to a year ahead.
  v_max_advance_days := public._caller_window(v_org_id, v_max_advance_days);

  -- 0051: only times the clinic actually offers. Nothing checked that
  -- p_start_at sat on the slot grid, so a booking at 09:07 blocked three
  -- 15-minute slots instead of two and filled the calendar with times
  -- the clinic never published.
  v_local_minutes := extract(hour from (p_start_at at time zone v_timezone))::int * 60
                     + extract(minute from (p_start_at at time zone v_timezone))::int;
  if extract(second from (p_start_at at time zone v_timezone)) <> 0 then
    raise exception 'slot_not_aligned';
  end if;

  select sv.id, sv.duration_minutes, sv.buffer_minutes into v_service_id, v_duration_minutes, v_buffer_minutes
  from public.services sv
  where sv.id = p_service_id and sv.org_id = v_org_id and sv.active;
  if v_service_id is null then
    raise exception 'service_not_found';
  end if;

  v_end_at := p_start_at + ((v_duration_minutes + v_buffer_minutes) || ' minutes')::interval;

  -- 0068: the rooms and devices the service needs. Their rows are locked
  -- first, so two bookings for the last free one wait for each other
  -- instead of both seeing it free.
  perform 1
  from public.resources r
  join public.service_resources sr on sr.resource_id = r.id
  where sr.service_id = p_service_id
  order by r.id
  for update of r;
  if not public._resources_free(v_org_id, p_service_id, p_start_at, v_end_at, null) then
    raise exception 'resource_busy';
  end if;

  -- On the clinic's grid (0051), or one of the times 0061 allows:
  --   * the next service of the same visit, booked a moment ago in this
  --     same call: it starts where the previous one ends, wherever that
  --     falls. 0051 refused it whenever a duration was not a multiple of
  --     the interval, after the page had offered the time;
  --   * with compact_slots on: right after a booked appointment ends, just
  --     before one starts, or right after a staff time off ends — the
  --     times _resource_slots offers. Overlap and hours are still checked
  --     below exactly as before; this only decides which minutes may be a
  --     start at all.
  if v_slot_interval > 0 and v_local_minutes % v_slot_interval <> 0
     and not exists (
       select 1 from public.appointments x
       where x.org_id = v_org_id and x.end_at = p_start_at
         and x.created_at = now()
         and public._norm_phone(x.customer_phone) = v_norm_phone)
     and not (v_compact and (
       exists (select 1 from public.appointments x
               where x.org_id = v_org_id and x.status = 'booked'
                 and (x.end_at = p_start_at or x.start_at = v_end_at))
       or exists (select 1 from public.staff_time_off t
                  where t.org_id = v_org_id and t.ends_at = p_start_at)))
  then
    raise exception 'slot_not_aligned';
  end if;
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
         v_org_id, v_norm_phone, p_start_at, v_end_at, v_caller_is_staff) then
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
       v_org_id, v_norm_phone, p_start_at, v_end_at, v_caller_is_staff) then
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
$function$;

CREATE OR REPLACE FUNCTION public._reschedule(p_appointment_id uuid, p_start_at timestamp with time zone)
 RETURNS TABLE(id uuid, start_at timestamp with time zone, end_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a record;
  v_timezone text;
  v_org_hours jsonb;
  v_min_notice int;
  v_max_advance int;
  v_duration int;
  v_buffer int;
  v_end_at timestamptz;
  v_local_date date;
  v_dow text;
  v_day jsonb;
  v_hours jsonb;
  v_open time;
  v_close time;
begin
  select ap.id, ap.org_id, ap.service_id, ap.staff_id, ap.status,
         ap.customer_name, ap.customer_phone, ap.start_at as old_start
  into a
  from public.appointments ap
  where ap.id = p_appointment_id;

  if a.id is null then
    raise exception 'booking_not_found';
  end if;
  if a.status <> 'booked' then
    -- A cancelled or completed appointment is history; moving it would
    -- silently resurrect it onto the calendar.
    raise exception 'booking_not_active';
  end if;

  if exists (select 1 from public.organizations o where o.id = a.org_id and public._org_closed(o.deleted_at, o.plan_expires_at)) then
    raise exception 'org_not_found';
  end if;

  select s.timezone, s.business_hours, s.min_notice_minutes, s.max_advance_days
  into v_timezone, v_org_hours, v_min_notice, v_max_advance
  from public.org_settings s where s.org_id = a.org_id;
  -- 0067: the clinic itself may move a visit up to a year ahead.
  v_max_advance := public._caller_window(a.org_id, v_max_advance);

  select sv.duration_minutes, sv.buffer_minutes into v_duration, v_buffer
  from public.services sv where sv.id = a.service_id;
  if v_duration is null then
    raise exception 'service_not_found';
  end if;

  v_end_at := p_start_at + ((v_duration + v_buffer) || ' minutes')::interval;
  v_local_date := (p_start_at at time zone v_timezone)::date;

  if p_start_at < now() + (v_min_notice || ' minutes')::interval then
    raise exception 'too_soon';
  end if;
  if v_local_date > (now() at time zone v_timezone)::date + v_max_advance then
    raise exception 'too_far_ahead';
  end if;

  -- The assigned specialist's own hours when there is one, the org's
  -- otherwise — the same rule book_appointment applies.
  if a.staff_id is not null then
    select coalesce(m.business_hours, v_org_hours) into v_hours
    from public.memberships m where m.id = a.staff_id;
  end if;
  v_hours := coalesce(v_hours, v_org_hours);

  v_dow := extract(dow from v_local_date)::int::text;
  v_day := v_hours -> v_dow;
  if v_day is null or (v_day ->> 'closed')::boolean then
    raise exception 'outside_business_hours';
  end if;
  v_open := (v_day ->> 'open')::time;
  v_close := (v_day ->> 'close')::time;
  -- Real instants, never ::time — see 0027 section 6(a).
  if p_start_at < (v_local_date + v_open) at time zone v_timezone
     or v_end_at > (v_local_date + v_close) at time zone v_timezone then
    raise exception 'outside_business_hours';
  end if;

  if a.staff_id is not null and exists (
    select 1 from public.staff_time_off t
    where t.staff_membership_id = a.staff_id
      and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_start_at, v_end_at, '[)')
  ) then
    raise exception 'outside_business_hours';
  end if;

  -- 0068: the rooms and devices the service needs. Their rows are locked
  -- first, so two bookings for the last free one wait for each other
  -- instead of both seeing it free.
  perform 1
  from public.resources r
  join public.service_resources sr on sr.resource_id = r.id
  where sr.service_id = a.service_id
  order by r.id
  for update of r;
  if not public._resources_free(a.org_id, a.service_id, p_start_at, v_end_at, a.id) then
    raise exception 'resource_busy';
  end if;

  begin
    update public.appointments ap
    set start_at = p_start_at, end_at = v_end_at, updated_at = now()
    where ap.id = p_appointment_id;
  exception
    when exclusion_violation then
      raise exception 'slot_taken';
  end;

  -- The clinic is told, the same way it is told about a new booking.
  -- Wrapped for the same reason: a notification must never undo the move.
  begin
    insert into public.notifications (org_id, kind, title, body, appointment_id)
    values (
      a.org_id,
      'booking_rescheduled',
      a.customer_name,
      to_char(a.old_start at time zone coalesce(v_timezone, 'Asia/Amman'), 'YYYY-MM-DD HH24:MI')
        || ' → '
        || to_char(p_start_at at time zone coalesce(v_timezone, 'Asia/Amman'), 'YYYY-MM-DD HH24:MI')
        || ' · ' || a.customer_phone,
      a.id
    )
    -- The 0029 index is PARTIAL, so the conflict target has to repeat
    -- its predicate or PostgreSQL will not match it and the statement
    -- fails with "no unique or exclusion constraint matching".
    --
    -- do update, not do nothing: moving the same appointment twice must
    -- show the latest move, and must come back unread — a clinic that
    -- already dismissed the first notice would otherwise never learn
    -- about the second.
    on conflict (appointment_id, kind) where appointment_id is not null
    do update set body = excluded.body, created_at = now(), read_at = null;
  exception when others then
    null;
  end;

  return query
    select ap.id, ap.start_at, ap.end_at
    from public.appointments ap where ap.id = p_appointment_id;
end;
$function$;


-- ---------------------------------------------------------------------
-- 4. Managing them: the owner writes, every member reads.
-- ---------------------------------------------------------------------
drop function if exists public.list_resources();
create function public.list_resources()
returns table (id uuid, name text, kind text, capacity int, service_ids uuid[])
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
begin
  select me.org_id into v_org from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  return query
    select r.id, r.name, r.kind, r.capacity,
           coalesce(array(select sr.service_id from public.service_resources sr where sr.resource_id = r.id), '{}'::uuid[])
    from public.resources r
    where r.org_id = v_org
    order by r.kind, r.name;
end;
$$;

revoke all on function public.list_resources() from public, anon;
grant execute on function public.list_resources() to authenticated;

-- p_id NULL adds; otherwise edits.
drop function if exists public.save_resource(uuid, text, text, int);
create function public.save_resource(p_id uuid, p_name text, p_kind text, p_capacity int)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
  v_id uuid;
begin
  select me.org_id, me.role into v_org, v_role from public._my_member() me;
  if v_org is null or not coalesce(v_role = 'owner', false) then
    raise exception 'not_authorized';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 60 then
    raise exception 'resource_name';
  end if;
  if p_kind is null or p_kind not in ('room', 'device') then
    raise exception 'resource_kind';
  end if;
  if not coalesce(p_capacity between 1 and 20, false) then
    raise exception 'resource_capacity';
  end if;
  if p_id is null then
    insert into public.resources (org_id, name, kind, capacity)
    values (v_org, btrim(p_name), p_kind, p_capacity)
    returning id into v_id;
  else
    update public.resources r
       set name = btrim(p_name), kind = p_kind, capacity = p_capacity
     where r.id = p_id and r.org_id = v_org
    returning r.id into v_id;
    if v_id is null then
      raise exception 'resource_not_found';
    end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_resource(uuid, text, text, int) from public, anon;
grant execute on function public.save_resource(uuid, text, text, int) to authenticated;

drop function if exists public.delete_resource(uuid);
create function public.delete_resource(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
  v_count int;
begin
  select me.org_id, me.role into v_org, v_role from public._my_member() me;
  if v_org is null or not coalesce(v_role = 'owner', false) then
    raise exception 'not_authorized';
  end if;
  delete from public.resources r where r.id = p_id and r.org_id = v_org;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'resource_not_found';
  end if;
  return true;
end;
$$;

revoke all on function public.delete_resource(uuid) from public, anon;
grant execute on function public.delete_resource(uuid) to authenticated;

-- Replaces what one service needs. Every id must be this clinic's.
drop function if exists public.set_service_resources(uuid, uuid[]);
create function public.set_service_resources(p_service_id uuid, p_resource_ids uuid[])
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
  v_ids uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_resource_ids, '{}'::uuid[])) x), '{}');
begin
  select me.org_id, me.role into v_org, v_role from public._my_member() me;
  if v_org is null or not coalesce(v_role = 'owner', false) then
    raise exception 'not_authorized';
  end if;
  if not exists (select 1 from public.services s where s.id = p_service_id and s.org_id = v_org) then
    raise exception 'service_not_found';
  end if;
  if (select count(*) from public.resources r where r.id = any(v_ids) and r.org_id = v_org) <> cardinality(v_ids) then
    raise exception 'resource_not_found';
  end if;
  delete from public.service_resources sr where sr.service_id = p_service_id;
  insert into public.service_resources (service_id, resource_id, org_id)
  select p_service_id, x, v_org from unnest(v_ids) x;
  return cardinality(v_ids);
end;
$$;

revoke all on function public.set_service_resources(uuid, uuid[]) from public, anon;
grant execute on function public.set_service_resources(uuid, uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select count(*) from information_schema.tables where table_name in ('resources','service_resources');  -- 2
-- select has_table_privilege('authenticated', 'public.resources', 'select');                            -- false
