-- Appointments + the availability engine.
--
-- Guest-first booking (see plan): no customer account required. Self-
-- service (view/cancel) is gated by an unguessable cancel_token, not auth.
-- This table therefore gets NO public/anon select policy at all — that
-- would leak other customers' names/phone numbers to anyone browsing a
-- clinic's public page. All public read/write access goes through the
-- narrow security-definer RPCs below.

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null references public.services(id),
  staff_id uuid references public.memberships(id),
  -- Deliberate v1 simplification: an unassigned ("any available staff")
  -- booking is checked against a single shared org-level resource, not
  -- against every individual staff member's calendar. A clinic that wants
  -- real per-staff capacity for "any available" bookings needs v2's
  -- per-staff scheduling; for now this just prevents double-booking the
  -- org's one shared slot when staff isn't configured yet.
  resource_id uuid generated always as (coalesce(staff_id, org_id)) stored,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  customer_user_id uuid references auth.users(id), -- reserved, unused in v1
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked', 'cancelled', 'completed', 'no_show')),
  cancel_token uuid not null default gen_random_uuid() unique,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint end_after_start check (end_at > start_at),
  -- The real concurrency guard: two overlapping 'booked' rows for the same
  -- resource can never both commit, even under simultaneous requests.
  -- Read-time filtering in get_available_slots() mirrors this so a slot
  -- offered to a customer is (almost always) still free by the time they
  -- submit — this constraint is what makes the rare race safe regardless.
  constraint no_overlap exclude using gist (
    resource_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (status = 'booked')
);

create index appointments_org_start_idx on public.appointments (org_id, start_at);
create index appointments_staff_idx on public.appointments (staff_id);

alter table public.appointments enable row level security;

create policy "members can view org appointments"
  on public.appointments for select
  using (public.is_org_member(org_id));

create policy "owner can manage org appointments"
  on public.appointments for all
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));

create policy "staff can update their own appointments"
  on public.appointments for update
  using (
    staff_id in (select id from public.memberships m where m.user_id = auth.uid() and m.org_id = appointments.org_id)
  )
  with check (
    staff_id in (select id from public.memberships m where m.user_id = auth.uid() and m.org_id = appointments.org_id)
  );

-- =======================================================================
-- get_available_slots(): resolves org+service+business-hours+existing
-- bookings and returns bookable start times for one calendar day, in a
-- single round trip. Anonymous-callable (the public booking page has no
-- session). Never returns raw appointment rows — only start timestamps.
-- =======================================================================
create function public.get_available_slots(
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
  v_business_hours jsonb;
  v_slot_interval_minutes int;
  v_min_notice_minutes int;
  v_max_advance_days int;
  v_service_id uuid;
  v_duration_minutes int;
  v_buffer_minutes int;
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
  v_resource_id uuid;
  v_slot_len interval;
begin
  select o.id, o.deleted_at into v_org_id, v_org_deleted_at
  from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null or v_org_deleted_at is not null then
    return;
  end if;

  select s.timezone, s.business_hours, s.slot_interval_minutes, s.min_notice_minutes, s.max_advance_days
  into v_timezone, v_business_hours, v_slot_interval_minutes, v_min_notice_minutes, v_max_advance_days
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
    if not exists (select 1 from public.memberships m where m.id = p_staff_id and m.org_id = v_org_id) then
      return;
    end if;
    if exists (select 1 from public.staff_services ss where ss.service_id = p_service_id)
       and not exists (
         select 1 from public.staff_services ss
         where ss.service_id = p_service_id and ss.staff_membership_id = p_staff_id
       )
    then
      return; -- this staff member doesn't perform this service
    end if;
  end if;

  v_today := (now() at time zone v_timezone)::date;
  if p_date < v_today or p_date > v_today + v_max_advance_days then
    return;
  end if;

  v_dow := extract(dow from p_date)::int::text;
  v_day := v_business_hours -> v_dow;
  if v_day is null or (v_day ->> 'closed')::boolean then
    return;
  end if;

  v_open := (v_day ->> 'open')::time;
  v_close := (v_day ->> 'close')::time;
  v_day_start := p_date::timestamp + v_open;
  v_day_end := p_date::timestamp + v_close;
  v_step := (v_slot_interval_minutes || ' minutes')::interval;
  v_slot_len := ((v_duration_minutes + v_buffer_minutes) || ' minutes')::interval;
  v_resource_id := coalesce(p_staff_id, v_org_id);

  v_slot_local := v_day_start;
  while v_slot_local + v_slot_len <= v_day_end loop
    v_slot_utc := v_slot_local at time zone v_timezone;

    if v_slot_utc >= now() + (v_min_notice_minutes || ' minutes')::interval then
      if not exists (
        select 1 from public.appointments a
        where a.resource_id = v_resource_id
          and a.status = 'booked'
          and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(v_slot_utc, v_slot_utc + v_slot_len, '[)')
      ) then
        start_at := v_slot_utc;
        return next;
      end if;
    end if;

    v_slot_local := v_slot_local + v_step;
  end loop;
end;
$$;

revoke all on function public.get_available_slots(text, uuid, date, uuid) from public;
grant execute on function public.get_available_slots(text, uuid, date, uuid) to anon, authenticated;

-- =======================================================================
-- book_appointment(): re-validates everything server-side (never trusts
-- the client's slot choice) and inserts. The EXCLUDE constraint above is
-- the actual race-condition guard — a unique_violation-style error here
-- just means "someone just took this slot."
-- =======================================================================
create function public.book_appointment(
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
  v_business_hours jsonb;
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
begin
  if trim(p_customer_name) = '' or trim(p_customer_phone) = '' then
    raise exception 'missing_contact_info';
  end if;

  select o.id, o.deleted_at into v_org_id, v_org_deleted_at
  from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null or v_org_deleted_at is not null then
    raise exception 'org_not_found';
  end if;

  select s.timezone, s.business_hours, s.min_notice_minutes, s.max_advance_days
  into v_timezone, v_business_hours, v_min_notice_minutes, v_max_advance_days
  from public.org_settings s where s.org_id = v_org_id;

  select sv.id, sv.duration_minutes, sv.buffer_minutes into v_service_id, v_duration_minutes, v_buffer_minutes
  from public.services sv
  where sv.id = p_service_id and sv.org_id = v_org_id and sv.active;
  if v_service_id is null then
    raise exception 'service_not_found';
  end if;

  if p_staff_id is not null then
    if not exists (select 1 from public.memberships m where m.id = p_staff_id and m.org_id = v_org_id) then
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
  end if;

  v_end_at := p_start_at + ((v_duration_minutes + v_buffer_minutes) || ' minutes')::interval;
  v_local_date := (p_start_at at time zone v_timezone)::date;
  v_dow := extract(dow from v_local_date)::int::text;
  v_day := v_business_hours -> v_dow;

  if v_day is null or (v_day ->> 'closed')::boolean then
    raise exception 'outside_business_hours';
  end if;

  v_open := (v_day ->> 'open')::time;
  v_close := (v_day ->> 'close')::time;

  if (p_start_at at time zone v_timezone)::time < v_open
     or (v_end_at at time zone v_timezone)::time > v_close
  then
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
        org_id, service_id, staff_id, customer_name, customer_phone, customer_email, start_at, end_at, notes
      )
      values (
        v_org_id, p_service_id, p_staff_id, trim(p_customer_name), trim(p_customer_phone),
        nullif(trim(coalesce(p_customer_email, '')), ''), p_start_at, v_end_at, nullif(trim(coalesce(p_notes, '')), '')
      )
      returning appointments.id, appointments.cancel_token;
  exception
    when exclusion_violation then
      raise exception 'slot_taken';
  end;
end;
$$;

revoke all on function public.book_appointment(text, uuid, timestamptz, text, text, uuid, text, text) from public;
grant execute on function public.book_appointment(text, uuid, timestamptz, text, text, uuid, text, text) to anon, authenticated;

-- =======================================================================
-- Guest self-service, token-gated (no session needed).
-- =======================================================================
create function public.get_booking_by_token(p_cancel_token uuid)
returns table (
  id uuid,
  org_name text,
  service_name text,
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
  select a.id, o.name, sv.name, a.start_at, a.end_at, a.status, a.customer_name
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  join public.services sv on sv.id = a.service_id
  where a.cancel_token = p_cancel_token;
$$;

revoke all on function public.get_booking_by_token(uuid) from public;
grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;

create function public.cancel_booking_by_token(p_cancel_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.appointments
  set status = 'cancelled', updated_at = now()
  where cancel_token = p_cancel_token and status = 'booked';

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke all on function public.cancel_booking_by_token(uuid) from public;
grant execute on function public.cancel_booking_by_token(uuid) to anon, authenticated;
