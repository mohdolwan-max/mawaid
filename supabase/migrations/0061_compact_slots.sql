-- Compact scheduling: an option per clinic that removes the gaps the slot
-- grid leaves between appointments (owner, 2026-10-25: «ضيف التحسين الي
-- بلغي الفجوات لكن خليه اختياري حسب رغبة العيادة»).
--
-- The problem. Start times walk the clinic's grid (slot_interval_minutes,
-- 15 by default). A service whose length is not a multiple of the grid
-- leaves dead time: a 20-minute visit at 09:00 ends 09:20, and the next
-- start is 09:30, so ten minutes of the specialist's day are never
-- offered to anyone.
--
-- The option (org_settings.compact_slots, OFF by default, so no clinic's
-- calendar changes until its owner turns it on). For each specialist and
-- day, the times offered become the grid PLUS:
--   * the moment a booked appointment ends (its end already includes the
--     service's preparation time), so the next customer starts the moment
--     the specialist is free;
--   * the moment that makes the new service end exactly when a booked
--     appointment starts, which fills the gap before it;
--   * the moment a staff time off ends.
-- Every candidate then passes the very same checks as before: inside the
-- specialist's hours, no overlap with any booking, not in time off, after
-- the minimum notice. Only the set of candidate minutes grows; nothing a
-- booking must satisfy is relaxed. The database's no-overlap constraint
-- remains the final word.
--
-- Also fixed here, for every clinic whatever the option: a visit of
-- several services was refused with slot_not_aligned whenever the first
-- service's length was not a multiple of the grid (0051 checked EVERY
-- segment against the grid, but only the first one starts on it). Found
-- while building this: a 20-minute then 30-minute visit was offered 45
-- times on a test day and refused at every one of them.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The setting.
-- ---------------------------------------------------------------------
alter table public.org_settings
  add column if not exists compact_slots boolean not null default false;


-- ---------------------------------------------------------------------
-- 2. _resource_slots gains p_compact. A new parameter is a new signature:
--    the old one is dropped first, or a ten-argument call would match both.
-- ---------------------------------------------------------------------
drop function if exists public._resource_slots(text, jsonb, integer, integer, integer, integer, integer, date, uuid, uuid);
drop function if exists public._resource_slots(text, jsonb, integer, integer, integer, integer, integer, date, uuid, uuid, boolean);
create function public._resource_slots(
  p_timezone text,
  p_business_hours jsonb,
  p_slot_interval_minutes integer,
  p_min_notice_minutes integer,
  p_max_advance_days integer,
  p_duration_minutes integer,
  p_buffer_minutes integer,
  p_date date,
  p_resource_id uuid,
  p_time_off_membership_id uuid default null,
  p_compact boolean default false
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
  v_start_utc timestamptz;
  v_end_utc timestamptz;
  v_step interval;
  v_slot_len interval;
  v_slot_utc timestamptz;
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
  v_start_utc := v_day_start at time zone p_timezone;
  v_end_utc := v_day_end at time zone p_timezone;
  -- A zero step would never advance; the settings form allows 5 and up.
  v_step := (greatest(coalesce(p_slot_interval_minutes, 15), 1) || ' minutes')::interval;
  v_slot_len := ((p_duration_minutes + p_buffer_minutes) || ' minutes')::interval;

  for v_slot_utc in
    select distinct c.at
    from (
      -- The grid, as before.
      select (g at time zone p_timezone) as at
      from generate_series(v_day_start, v_day_end - v_slot_len, v_step) g
      union
      -- Compact: the moment a booking of this specialist ends…
      select a.end_at
      from public.appointments a
      where p_compact and a.resource_id = p_resource_id and a.status = 'booked'
        and a.end_at >= v_start_utc and a.end_at + v_slot_len <= v_end_utc
      union
      -- …the start that ends exactly when one of their bookings begins…
      select a.start_at - v_slot_len
      from public.appointments a
      where p_compact and a.resource_id = p_resource_id and a.status = 'booked'
        and a.start_at - v_slot_len >= v_start_utc and a.start_at <= v_end_utc
      union
      -- …and the moment their time off ends.
      select t.ends_at
      from public.staff_time_off t
      where p_compact and p_time_off_membership_id is not null
        and t.staff_membership_id = p_time_off_membership_id
        and t.ends_at >= v_start_utc and t.ends_at + v_slot_len <= v_end_utc
    ) c
    order by 1
  loop
    -- The same three checks as before, for every candidate alike.
    if v_slot_utc >= now() + (p_min_notice_minutes || ' minutes')::interval
       and not exists (
         select 1 from public.appointments a
         where a.resource_id = p_resource_id
           and a.status = 'booked'
           and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(v_slot_utc, v_slot_utc + v_slot_len, '[)')
       )
       and (
         p_time_off_membership_id is null or not exists (
           select 1 from public.staff_time_off t
           where t.staff_membership_id = p_time_off_membership_id
             and tstzrange(t.starts_at, t.ends_at) && tstzrange(v_slot_utc, v_slot_utc + v_slot_len, '[)')
         )
       )
    then
      start_at := v_slot_utc;
      return next;
    end if;
  end loop;
end;
$$;

-- Internal, as since 0028: only get_available_slots calls it.
revoke all on function public._resource_slots(text, jsonb, integer, integer, integer, integer, integer, date, uuid, uuid, boolean) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. get_available_slots: reads the flag and passes it on.
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
$function$
;


-- ---------------------------------------------------------------------
-- 4. _book_one: which start minutes it accepts (see the comment inside).
-- ---------------------------------------------------------------------
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
$function$
;

-- Internal, as since 0028: only the booking RPCs call it.
revoke all on function public._book_one(text, uuid, timestamptz, text, text, uuid, text, text, boolean) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select column_name, column_default from information_schema.columns
--  where table_name = 'org_settings' and column_name = 'compact_slots';      -- false
-- select has_function_privilege('anon', 'public._resource_slots(text,jsonb,integer,integer,integer,integer,integer,date,uuid,uuid,boolean)', 'execute');  -- false
