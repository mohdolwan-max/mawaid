-- Customer accounts. A "customer" is any auth user with a row here —
-- that row (not user_metadata) is the source of truth distinguishing
-- customers from org members. Same auth.users pool as org users;
-- get_my_context() is untouched.

create table public.customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customers enable row level security;

-- Own-row only; direct table access is fine here (unlike appointments,
-- nothing cross-customer is exposed).
create policy "customer can view own profile"
  on public.customers for select
  using (user_id = auth.uid());

create policy "customer can create own profile"
  on public.customers for insert
  with check (user_id = auth.uid());

create policy "customer can update own profile"
  on public.customers for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- list_my_bookings(): the signed-in customer's bookings across all orgs.
-- ---------------------------------------------------------------------
create function public.list_my_bookings()
returns table (
  id uuid,
  org_name text,
  org_slug text,
  service_name text,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  cancel_token uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, o.name, o.slug, sv.name, a.start_at, a.end_at, a.status, a.cancel_token
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  join public.services sv on sv.id = a.service_id
  where a.customer_user_id = auth.uid()
  order by a.start_at desc;
$$;

revoke all on function public.list_my_bookings() from public;
grant execute on function public.list_my_bookings() to authenticated;

-- ---------------------------------------------------------------------
-- book_appointment(): now links the booking to the caller when they are
-- a signed-in CUSTOMER (a customers row exists — this check keeps org
-- owners' test bookings on their own page from self-linking). Same
-- signature and return type, so create or replace is safe.
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

  -- Link to the caller only when they are a registered customer.
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
