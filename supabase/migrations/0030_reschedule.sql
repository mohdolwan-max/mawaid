-- Rescheduling. Until now the only way to move an appointment was to
-- cancel it and book again, which loses the slot in between — if someone
-- else takes it in that gap, the customer wanted 5pm and now has nothing.
--
-- Deliberately an UPDATE in place rather than cancel-and-rebook:
--
--   * the cancel_token is a capability URL that the customer already has
--     in their confirmation email. Rebooking mints a new one and their
--     link 404s.
--   * the appointment id is referenced by reviews.appointment_id (unique,
--     not null) and push_subscriptions.appointment_id. A new row orphans
--     both.
--   * the exclusion constraint does the hard part for free: updating a
--     row does not conflict with its own previous version, so moving
--     3:00-4:00 to 3:30-4:30 is allowed, while overlapping SOMEONE ELSE
--     is rejected at the same isolation guarantee as a fresh booking.
--
-- What this does NOT do: move a whole multi-service visit at once. Each
-- segment moves on its own, which can leave a gap between them. Moving
-- the chain as a unit means re-deriving every segment's offset and
-- re-validating each — worth doing, but it is a separate change and
-- pretending otherwise here would ship a half-version of it.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. A third notification kind. Same name-agnostic drop as 0029 — the
--    constraint added there IS named, but re-deriving it from what it
--    does costs nothing and survives someone renaming it.
-- ---------------------------------------------------------------------
do $do$
declare
  c text;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = 'notifications'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%booking_cancelled%'
  loop
    execute format('alter table public.notifications drop constraint %I', c);
  end loop;
end
$do$;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('booking_created', 'booking_cancelled', 'booking_rescheduled'));


-- ---------------------------------------------------------------------
-- 2. The core. Both entry points below funnel through this, so a clinic
--    moving an appointment and a customer moving the same appointment
--    are validated identically.
--
-- Booking CONFLICTS are not checked here on purpose — the exclusion
-- constraint is the only correct place for that, because a check-then-
-- write in application code loses to a simultaneous request. Everything
-- this validates is the part a constraint cannot express: opening hours,
-- time off, notice and how far ahead bookings are allowed.
-- ---------------------------------------------------------------------
create or replace function public._reschedule(
  p_appointment_id uuid,
  p_start_at timestamptz
)
returns table (id uuid, start_at timestamptz, end_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
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

  if exists (select 1 from public.organizations o where o.id = a.org_id and o.deleted_at is not null) then
    raise exception 'org_not_found';
  end if;

  select s.timezone, s.business_hours, s.min_notice_minutes, s.max_advance_days
  into v_timezone, v_org_hours, v_min_notice, v_max_advance
  from public.org_settings s where s.org_id = a.org_id;

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
$$;

revoke all on function public._reschedule(uuid, timestamptz) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. The customer's way in: the cancel token they already hold.
--
-- Named for what it does to a booking, not for the token — the token is
-- simply the capability that proves this is their appointment, exactly
-- as it does for get_booking_by_token and cancel_booking_by_token.
-- ---------------------------------------------------------------------
create or replace function public.reschedule_booking_by_token(
  p_cancel_token uuid,
  p_start_at timestamptz
)
returns table (id uuid, start_at timestamptz, end_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select ap.id into v_id from public.appointments ap where ap.cancel_token = p_cancel_token;
  if v_id is null then
    raise exception 'booking_not_found';
  end if;
  return query select * from public._reschedule(v_id, p_start_at);
end;
$$;

revoke all on function public.reschedule_booking_by_token(uuid, timestamptz) from public;
grant execute on function public.reschedule_booking_by_token(uuid, timestamptz) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. The clinic's way in. Reception takes the "can I move it to five?"
--    call far more often than the customer opens their own link, so this
--    is the path that actually gets used.
--
-- is_org_member, not is_org_owner: whoever answers the phone is usually
-- not the owner, and they can already cancel from the dashboard — being
-- allowed to destroy an appointment but not move it would be perverse.
-- ---------------------------------------------------------------------
create or replace function public.reschedule_booking(
  p_appointment_id uuid,
  p_start_at timestamptz
)
returns table (id uuid, start_at timestamptz, end_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select ap.org_id into v_org_id from public.appointments ap where ap.id = p_appointment_id;
  if v_org_id is null then
    raise exception 'booking_not_found';
  end if;
  if not public.is_org_member(v_org_id) then
    raise exception 'not_authorized';
  end if;
  return query select * from public._reschedule(p_appointment_id, p_start_at);
end;
$$;

revoke all on function public.reschedule_booking(uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_booking(uuid, timestamptz) to authenticated;


-- ---------------------------------------------------------------------
-- 5. get_booking_by_token, widened so the manage page can offer a slot
--    picker.
--
-- It returned service NAME but not service id, org slug or staff id — so
-- the page could say what was booked but had no way to ask what else is
-- available. Rather than adding a near-duplicate of get_available_slots
-- that resolves those internally, the three ids are exposed and the page
-- calls the SAME slot RPC the customer used when booking. One source of
-- truth for what "available" means.
--
-- Return type changes, so this is DROP + CREATE, and the grants 0004
-- gave it must be restated — the lesson from 0024, where a DROP silently
-- discarded them.
--
-- One known limitation, stated rather than hidden: the slot list treats
-- the appointment's own current window as occupied, because it is. So a
-- customer moving a 60-minute booking from 3:00 to 3:15 will not be
-- offered 3:15. Moving it somewhere genuinely different — which is what
-- rescheduling is for — is unaffected. Fixing it properly needs an
-- "ignore this appointment" parameter threaded through _resource_slots,
-- which is a change to the booking read path and does not belong in the
-- same migration as the write path.
-- ---------------------------------------------------------------------
drop function public.get_booking_by_token(uuid);

create function public.get_booking_by_token(p_cancel_token uuid)
returns table (
  id uuid,
  org_name text,
  org_slug text,
  service_name text,
  service_id uuid,
  staff_id uuid,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  customer_name text
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, o.name, o.slug, sv.name, a.service_id, a.staff_id,
         a.start_at, a.end_at, a.status, a.customer_name
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  join public.services sv on sv.id = a.service_id
  where a.cancel_token = p_cancel_token
     or (
       a.visit_id is not null
       and a.visit_id = (
         select v.visit_id from public.appointments v
         where v.cancel_token = p_cancel_token
       )
     )
  order by a.start_at;
$$;

revoke all on function public.get_booking_by_token(uuid) from public;
grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;
