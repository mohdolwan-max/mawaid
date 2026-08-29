-- Abuse-prevention layer for the public booking RPC. Same signature and
-- return type as the version in 0007_customers.sql, so `create or replace`
-- is safe (no drop needed).
--
-- Guards added:
--  1. Per-phone rate limit: a phone number that already has 6+ 'booked'
--     rows created in the last hour (platform-wide, not per-org) is
--     rejected — well above any real customer's normal usage, but shuts
--     down a bot flooding the calendar with junk bookings.
--  2. Defense in depth alongside the client-side honeypot field (see
--     BookingClient.tsx) — a bot that skips the browser entirely and
--     calls the RPC directly still hits this limit.

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
  v_customer_user_id uuid;
  v_recent_count int;
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

  select c.user_id into v_customer_user_id
  from public.customers c where c.user_id = auth.uid();

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
end;
$$;
