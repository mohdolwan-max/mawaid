-- Recurring appointments (owner, 2026-10-25, item 7 of the roadmap: "المواعيد
-- المتكررة"). Reception books "every two weeks, six times" in one go.
--
-- Decided here, and why:
--   * The clinic books a series; customers do not (their own page keeps
--     one visit at a time). Every appointment in it is an ordinary
--     booking, made through the same checks, so nothing in the diary is
--     special. series_id ties them together for "session 3 of 6" and for
--     "cancel this one and the rest".
--   * Nothing is written before the clinic has seen the whole series:
--     the screen proposes each date (the same time where it is free, the
--     nearest free time that day where it is not, or "no time that day")
--     and books only what was confirmed. A date that fails at the moment
--     of booking is reported, never silently dropped.
--   * The booking window (org_settings.max_advance_days) is how far ahead
--     CUSTOMERS may book. A series reaches further than any window a
--     clinic sets for that (six sessions four weeks apart is twenty
--     weeks), so the clinic's own members may look and book up to a year
--     ahead (_caller_window), and move a visit as far. Customers keep the
--     clinic's window exactly as before.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The window: the clinic's own members see a year ahead.
-- ---------------------------------------------------------------------
create or replace function public._caller_window(p_org uuid, p_days int)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is not null and exists (
      select 1 from public.memberships m where m.org_id = p_org and m.user_id = auth.uid())
    then greatest(coalesce(p_days, 30), 365)
    else p_days
  end;
$$;

revoke all on function public._caller_window(uuid, int) from public, anon, authenticated;

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

    return query
      select * from public._resource_slots(
        v_timezone, v_staff_hours, v_slot_interval_minutes, v_min_notice_minutes, v_max_advance_days,
        v_duration_minutes, v_buffer_minutes, p_date, p_staff_id, p_staff_id, v_compact
      );
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
    order by rs.start_at;
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
-- 2. The series.
-- ---------------------------------------------------------------------
alter table public.appointments add column if not exists series_id uuid;
create index if not exists appointments_series on public.appointments (series_id) where series_id is not null;
-- Members read appointments through column grants (0034): the new one
-- has to be named. The row policies are unchanged.
grant select (series_id) on public.appointments to authenticated;

-- Ties freshly booked appointments of one customer into a series.
-- Returns the series id.
drop function if exists public.link_series(uuid[]);
create function public.link_series(p_appointment_ids uuid[])
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_n int := coalesce(cardinality(p_appointment_ids), 0);
  v_series uuid := gen_random_uuid();
  v_ok int;
begin
  select me.org_id into v_org from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  if v_n < 2 or v_n > 24 then
    raise exception 'series_size';
  end if;
  -- All of them this clinic's, booked, not yet in a series, one customer,
  -- and made in the last hour (a series is linked as it is booked).
  select count(*) into v_ok
  from public.appointments a
  where a.id = any(p_appointment_ids)
    and a.org_id = v_org
    and a.status = 'booked'
    and a.series_id is null
    and a.created_at > now() - interval '1 hour';
  if v_ok <> (select count(distinct x) from unnest(p_appointment_ids) x)
     or (select count(distinct public._norm_phone(a.customer_phone)) from public.appointments a
         where a.id = any(p_appointment_ids)) <> 1 then
    raise exception 'series_invalid';
  end if;
  update public.appointments a set series_id = v_series where a.id = any(p_appointment_ids);
  return v_series;
end;
$$;

revoke all on function public.link_series(uuid[]) from public, anon;
grant execute on function public.link_series(uuid[]) to authenticated;

-- Cancels this appointment and every later booked one in its series. The
-- owner may cancel any; a staff member only a series wholly their own
-- (the same rule as cancelling one appointment, 0004's policies).
-- Returns how many were cancelled.
drop function if exists public.cancel_series_from(uuid);
create function public.cancel_series_from(p_appointment_id uuid)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_me uuid;
  v_role text;
  v_series uuid;
  v_start timestamptz;
  v_count int;
begin
  select me.org_id, me.membership_id, me.role into v_org, v_me, v_role from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  select a.series_id, a.start_at into v_series, v_start
  from public.appointments a where a.id = p_appointment_id and a.org_id = v_org;
  if v_series is null then
    raise exception 'series_not_found';
  end if;
  if not coalesce(v_role = 'owner', false)
     and exists (select 1 from public.appointments a
                 where a.series_id = v_series and a.status = 'booked' and a.start_at >= v_start
                   and a.staff_id is distinct from v_me) then
    raise exception 'not_authorized';
  end if;
  update public.appointments a
     set status = 'cancelled', updated_at = now()
   where a.series_id = v_series and a.org_id = v_org
     and a.status = 'booked' and a.start_at >= v_start;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.cancel_series_from(uuid) from public, anon;
grant execute on function public.cancel_series_from(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 3. The customer file (0064) gives each visit its place in its series.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_org_customer(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_me uuid;
  v_role text;
  v_phone text := public._norm_phone(p_phone);
  v_summary jsonb;
  v_visits jsonb;
  v_notes jsonb;
  v_tags text[];
  v_packages jsonb;
  v_catalogue jsonb;
begin
  select me.org_id, me.membership_id, me.role into v_org, v_me, v_role from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  if v_phone is null then
    return null;
  end if;

  select jsonb_build_object(
           'phone', v_phone,
           'name', (array_agg(a.customer_name order by a.start_at desc))[1],
           'email', (array_agg(a.customer_email order by a.start_at desc) filter (where a.customer_email is not null))[1],
           'completed', count(*) filter (where a.status = 'completed'),
           'no_shows', count(*) filter (where a.status = 'no_show'),
           'cancelled', count(*) filter (where a.status = 'cancelled'),
           'upcoming', count(*) filter (where a.status = 'booked' and a.start_at > now()),
           'first_visit', min(a.start_at) filter (where a.status = 'completed'),
           'last_visit', max(a.start_at) filter (where a.status = 'completed'),
           'next_visit', min(a.start_at) filter (where a.status = 'booked' and a.start_at > now()),
           'total_value', coalesce(sum(vv.value) filter (where a.status = 'completed'), 0),
           'unpriced', count(*) filter (where a.status = 'completed' and vv.value is null))
    into v_summary
  from public.appointments a
  left join public._visit_values(v_org) vv on vv.appointment_id = a.id
  where a.org_id = v_org and public._norm_phone(a.customer_phone) = v_phone
  having count(*) > 0;

  if v_summary is null then
    return null;
  end if;

  select coalesce(jsonb_agg(x order by x.start_at desc), '[]'::jsonb)
    into v_visits
  from (
    select a.id, a.start_at, a.status, a.notes, a.staff_id, a.booking_source, a.service_id,
           sv.name as service, vv.value,
           pr.customer_package_id as package_id,
           cp.name as package_name,
           coalesce(pr.auto, false) as package_auto,
           a.series_id,
           case when a.series_id is not null and a.status <> 'cancelled' then
             (select count(*) from public.appointments s
               where s.series_id = a.series_id and s.status <> 'cancelled' and s.start_at <= a.start_at) end as series_no,
           case when a.series_id is not null then
             (select count(*) from public.appointments s
               where s.series_id = a.series_id and s.status <> 'cancelled') end as series_total,
           (pr.appointment_id is not null and pr.customer_package_id is null) as package_off
    from public.appointments a
    left join public.services sv on sv.id = a.service_id
    left join public._visit_values(v_org) vv on vv.appointment_id = a.id
    left join public.package_redemptions pr on pr.appointment_id = a.id
    left join public.customer_packages cp on cp.id = pr.customer_package_id
    where a.org_id = v_org and public._norm_phone(a.customer_phone) = v_phone
    order by a.start_at desc
    limit 200
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'body', n.body, 'created_at', n.created_at,
           'author', coalesce(m.display_name, ''),
           'mine', n.author_membership_id = v_me,
           'can_delete', coalesce(n.author_membership_id = v_me, false) or v_role = 'owner')
         order by n.created_at desc), '[]'::jsonb)
    into v_notes
  from public.customer_notes n
  left join public.memberships m on m.id = n.author_membership_id
  where n.org_id = v_org and n.phone = v_phone;

  select f.tags into v_tags from public.customer_files f where f.org_id = v_org and f.phone = v_phone;

  -- Usable packages first, then by date of sale, newest first.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'name', x.name, 'service_id', x.service_id, 'service', x.service,
           'sessions_total', x.sessions_total, 'used', x.used, 'remaining', x.remaining,
           'price_paid', x.price_paid, 'sold_at', x.sold_at, 'expires_at', x.expires_at,
           'sold_by', x.sold_by, 'note', x.note, 'cancelled_at', x.cancelled_at,
           'refund_amount', x.refund_amount, 'status', x.status,
           'can_cancel', v_role = 'owner' and x.status <> 'cancelled')
         order by (x.status = 'active') desc, x.sold_at desc), '[]'::jsonb)
    into v_packages
  from public._customer_packages_of(v_org, v_phone) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'service_id', p.service_id, 'service', sv.name,
           'sessions', p.sessions, 'price', p.price, 'validity_days', p.validity_days)
         order by sv.name, p.sessions), '[]'::jsonb)
    into v_catalogue
  from public.service_packages p
  join public.services sv on sv.id = p.service_id
  where p.org_id = v_org and p.active;

  return v_summary
    || jsonb_build_object(
         'visits', v_visits, 'notes', v_notes, 'tags', to_jsonb(coalesce(v_tags, '{}'::text[])),
         'packages', v_packages, 'catalogue', v_catalogue, 'is_owner', v_role = 'owner');
end;
$function$;

revoke all on function public.get_org_customer(text) from public, anon;
grant execute on function public.get_org_customer(text) to authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select column_name from information_schema.columns where table_name = 'appointments' and column_name = 'series_id';  -- 1 row
-- select has_function_privilege('anon', 'public.link_series(uuid[])', 'execute');                                     -- false
