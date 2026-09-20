-- Booking abuse, after the external audit of 2026-09-20.
--
-- What the audit showed, and why each piece below exists:
--   * book_appointment and book_appointment_chain are granted to anon, so
--     anyone could call them straight through PostgREST with the publishable
--     key that ships in every browser. That skipped check_booking_source
--     entirely (0040 says so in its own header), because that ceiling lives
--     in the Server Action, not in the database.
--   * The chain accepted the same service id ten times, booking ten
--     appointments back to back, and all ten shared one created_at — so the
--     per-phone limit counted them as ONE request.
--   * A failed attempt cost nothing: every check raises before the insert,
--     and the limiter counts rows in appointments.
--   * _customer_busy looked the phone up across EVERY clinic, and the
--     distinct customer_time_conflict error turned that into an oracle: is
--     this number booked somewhere right now?
--   * Nothing checked that a start time sat on the clinic's slot grid, or
--     that the customer name had a sane length.
--
-- The fix that holds all of these: a booking ticket. Only our own server can
-- mint one (issue_booking_ticket is gated by app_config.booking_secret, the
-- same pattern as payments_secret in 0047), it is valid for ten minutes, for
-- one clinic, and it is consumed on FIRST USE — success or failure. A direct
-- PostgREST caller cannot mint tickets, so the per-source ceiling is no
-- longer optional, and a probe now costs a ticket instead of nothing.
--
-- Clinic members are exempt: a receptionist booking from the dashboard has a
-- session, and their bookings never went through the public ceiling anyway.
--
-- Owner steps after running this file:
--   1. insert into public.app_config (key, value)
--      values ('booking_secret', '<a long random string>')
--      on conflict (key) do update set value = excluded.value;
--   2. Put the SAME value in Vercel as BOOKING_SECRET, then redeploy.
--   Until both are set, public booking refuses with booking_unavailable and
--   the dashboard still books normally.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tickets.
-- ---------------------------------------------------------------------
create table if not exists public.booking_tickets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- The same salted hash the Server Action already computes (0040).
  source_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists booking_tickets_source_idx
  on public.booking_tickets (source_hash, created_at desc);
create index if not exists booking_tickets_created_idx
  on public.booking_tickets (created_at);

alter table public.booking_tickets enable row level security;
revoke all on public.booking_tickets from anon, authenticated;

create or replace function public._booking_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Fails closed on a missing or empty stored secret, exactly like
  -- _payments_secret_ok (0047) and the cron gate after 0032.
  select p_secret is not null
     and length(p_secret) > 0
     and exists (
       select 1 from public.app_config c
       where c.key = 'booking_secret'
         and c.value is not null
         and length(c.value) > 0
         and c.value = p_secret
     );
$$;

revoke all on function public._booking_secret_ok(text) from public, anon, authenticated;

-- Issued by the Server Action only. The ceiling lives here now, so calling
-- PostgREST directly cannot go around it.
drop function if exists public.issue_booking_ticket(text, text, text);
create function public.issue_booking_ticket(p_secret text, p_source_hash text, p_org_slug text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_hour int;
  v_day int;
  v_id uuid;
begin
  if not public._booking_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;
  if p_source_hash is null or length(p_source_hash) < 16 then
    raise exception 'bad_source';
  end if;

  select o.id into v_org_id
  from public.organizations o
  where o.slug = p_org_slug
    and not public._org_closed(o.deleted_at, o.plan_expires_at);
  if v_org_id is null then
    raise exception 'org_not_found';
  end if;

  -- Serialised per source: 0040's count-then-insert let a concurrent burst
  -- through, because every transaction read the same count before any of
  -- them committed.
  perform pg_advisory_xact_lock(hashtext('booking_ticket:' || p_source_hash));

  select count(*) filter (where t.created_at > now() - interval '1 hour'),
         count(*) filter (where t.created_at > now() - interval '1 day')
    into v_hour, v_day
  from public.booking_tickets t
  where t.source_hash = p_source_hash;

  -- Same numbers 0040 chose for the Server Action ceiling.
  if v_hour >= 3 or v_day >= 8 then
    raise exception 'rate_limited';
  end if;

  insert into public.booking_tickets (org_id, source_hash)
  values (v_org_id, p_source_hash)
  returning id into v_id;

  -- Cheap opportunistic prune, as in 0040.
  if random() < 0.05 then
    delete from public.booking_tickets where created_at < now() - interval '2 days';
  end if;

  return v_id;
end;
$$;

revoke all on function public.issue_booking_ticket(text, text, text) from public, anon, authenticated;
grant execute on function public.issue_booking_ticket(text, text, text) to anon;

-- Consumes one ticket, or refuses. A clinic member books without one.
create or replace function public._consume_booking_ticket(p_ticket uuid, p_org_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_used uuid;
begin
  if auth.uid() is not null and exists (
    select 1 from public.memberships m
    where m.org_id = p_org_id and m.user_id = auth.uid()
  ) then
    return;
  end if;

  if not exists (select 1 from public.app_config c where c.key = 'booking_secret' and length(coalesce(c.value, '')) > 0) then
    -- No secret configured yet: public booking is closed rather than open.
    raise exception 'booking_unavailable';
  end if;

  if p_ticket is null then
    raise exception 'booking_ticket_required';
  end if;

  -- Consumed on first use, whatever happens next: a probe that ends in
  -- customer_time_conflict has still spent it.
  update public.booking_tickets t
     set used_at = now()
   where t.id = p_ticket
     and t.org_id = p_org_id
     and t.used_at is null
     and t.created_at > now() - interval '10 minutes'
  returning t.id into v_used;

  if v_used is null then
    raise exception 'booking_ticket_invalid';
  end if;
end;
$$;

revoke all on function public._consume_booking_ticket(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. The customer-conflict check stops asking about other clinics.
-- ---------------------------------------------------------------------
-- The signed-in branch still looks platform-wide: those are the caller's
-- OWN appointments, so it tells them nothing they cannot already see. The
-- phone branch is now scoped to the clinic being booked, which is what
-- removes the oracle.
drop function if exists public._customer_busy(text, timestamptz, timestamptz, boolean);
create or replace function public._customer_busy(
  p_org_id uuid,
  p_norm_phone text,
  p_start timestamptz,
  p_end timestamptz,
  p_caller_is_staff boolean
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      not p_caller_is_staff
      and auth.uid() is not null
      and exists (
        select 1 from public.appointments a
        where a.customer_user_id = auth.uid()
          and a.status = 'booked'
          and a.start_at >= p_start - interval '1 day'
          and a.start_at <  p_end
          and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start, p_end, '[)')
      )
    )
    or (
      p_norm_phone is not null
      and exists (
        select 1 from public.appointments a
        where a.org_id = p_org_id
          and public._norm_phone(a.customer_phone) = p_norm_phone
          and a.status = 'booked'
          and a.start_at >= p_start - interval '1 day'
          and a.start_at <  p_end
          and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start, p_end, '[)')
      )
    );
$$;

revoke all on function public._customer_busy(uuid, text, timestamptz, timestamptz, boolean) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. The booking core, unchanged except for the five fixes named above.
--    Internal: only the two wrappers below may call it.
-- ---------------------------------------------------------------------
drop function if exists public._book_one(text, uuid, timestamptz, text, text, uuid, text, text, boolean);
create or replace function public._book_one(
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
  v_slot_interval int;
  v_local_minutes int;
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
         coalesce(s.slot_interval_minutes, 15)
  into v_timezone, v_org_hours, v_min_notice_minutes, v_max_advance_days, v_slot_interval
  from public.org_settings s where s.org_id = v_org_id;

  -- 0051: only times the clinic actually offers. Nothing checked that
  -- p_start_at sat on the slot grid, so a booking at 09:07 blocked three
  -- 15-minute slots instead of two and filled the calendar with times
  -- the clinic never published.
  v_local_minutes := extract(hour from (p_start_at at time zone v_timezone))::int * 60
                     + extract(minute from (p_start_at at time zone v_timezone))::int;
  if extract(second from (p_start_at at time zone v_timezone)) <> 0
     or (v_slot_interval > 0 and v_local_minutes % v_slot_interval <> 0) then
    raise exception 'slot_not_aligned';
  end if;

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
$$;

revoke all on function public._book_one(text, uuid, timestamptz, text, text, uuid, text, text, boolean) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. The public entry points: ticket first, then the same work as before.
-- ---------------------------------------------------------------------
drop function if exists public.book_appointment(text, uuid, timestamptz, text, text, uuid, text, text, boolean);
create function public.book_appointment(
  p_ticket uuid,
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
volatile
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select o.id into v_org_id from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null then
    raise exception 'org_not_found';
  end if;
  perform public._consume_booking_ticket(p_ticket, v_org_id);

  return query
    select b.id, b.cancel_token
    from public._book_one(
      p_org_slug, p_service_id, p_start_at, p_customer_name, p_customer_phone,
      p_staff_id, p_customer_email, p_notes, p_allow_overlap
    ) b;
end;
$$;

-- The old nine-argument signature is gone: a client that still calls it
-- gets PGRST202 (function not found) rather than an unguarded booking.
revoke all on function public.book_appointment(uuid, text, uuid, timestamptz, text, text, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.book_appointment(uuid, text, uuid, timestamptz, text, text, uuid, text, text, boolean) to anon, authenticated;

drop function if exists public.book_appointment_chain(text, uuid[], timestamptz, text, text, uuid, text, text, boolean);
create or replace function public.book_appointment_chain(
  p_ticket uuid,
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
  v_visit_id uuid := gen_random_uuid();
  v_count int;
  v_org_id uuid;
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'no_services';
  end if;

  v_count := array_length(p_service_ids, 1);
  if v_count > 10 then
    raise exception 'too_many_services';
  end if;
  -- 0051: the same service id ten times used to book ten appointments
  -- back to back on one rate-limit unit. A visit has each service once.
  if v_count <> (select count(distinct x) from unnest(p_service_ids) x) then
    raise exception 'duplicate_service';
  end if;

  select o.id into v_org_id from public.organizations o where o.slug = p_org_slug;
  if v_org_id is null then
    raise exception 'org_not_found';
  end if;
  -- One ticket covers the whole visit; a clinic member needs none.
  perform public._consume_booking_ticket(p_ticket, v_org_id);

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
    from public._book_one(
      p_org_slug, v_service_id, v_cursor,
      p_customer_name, p_customer_phone, p_staff_id,
      p_customer_email, p_notes, p_allow_overlap
    ) b;

    -- Only a real chain gets a visit_id; a single-service call leaves it
    -- NULL, which is what every pre-existing row already means.
    if v_count > 1 then
      update public.appointments a set visit_id = v_visit_id where a.id = v_booked.id;
    end if;

    id := v_booked.id;
    cancel_token := v_booked.cancel_token;
    service_id := v_service_id;
    start_at := v_cursor;
    return next;

    v_cursor := v_cursor + ((v_duration + v_buffer) || ' minutes')::interval;
  end loop;
end;
$$;

revoke all on function public.book_appointment_chain(uuid, text, uuid[], timestamptz, text, text, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.book_appointment_chain(uuid, text, uuid[], timestamptz, text, text, uuid, text, text, boolean) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. Storage: stop anonymous listing of every clinic's files.
-- ---------------------------------------------------------------------
-- The bucket stays public, so the URLs a clinic publishes keep working
-- without a signed request. What changes is the API path: an anonymous
-- caller could LIST every object of every org through storage.objects.
drop policy if exists "public can view org media" on storage.objects;
drop policy if exists "org media listable by owner" on storage.objects;
create policy "org media listable by owner"
  on storage.objects for select
  using (
    bucket_id = 'org-media'
    and public.is_org_owner(((storage.foldername(name))[1])::uuid)
  );


-- ---------------------------------------------------------------------
-- 6. The next table added does not arrive granted to the API roles.
-- ---------------------------------------------------------------------
-- 0028 did this for functions after finding that Supabase grants new
-- objects to anon and authenticated by name, so a plain
-- `revoke ... from public` closes nothing. The same is true of tables,
-- and the audit (2026-09-20) found the newer tables each carrying their
-- own explicit revoke while the older ones rely on RLS alone. This makes
-- the safe default automatic for everything created from now on; the
-- existing tables keep their grants, because nine of them are read
-- directly by the app through PostgREST.
alter default privileges in schema public revoke all on tables from anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. Length limits at the column, not only in the function.
-- ---------------------------------------------------------------------
alter table public.appointments drop constraint if exists appointments_name_length;
alter table public.appointments
  add constraint appointments_name_length check (char_length(customer_name) <= 80);
alter table public.appointments drop constraint if exists appointments_notes_length;
alter table public.appointments
  add constraint appointments_notes_length check (notes is null or char_length(notes) <= 500);


-- ---------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------
-- 1. The old unguarded entry points are gone (expect 0 rows):
--      select p.oid::regprocedure::text
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname in ('book_appointment', 'book_appointment_chain')
--        and pg_get_function_identity_arguments(p.oid) not like 'p_ticket uuid%';
--
-- 2. Nobody can mint a ticket without the secret (expect false, false):
--      select has_function_privilege('authenticated', 'public.issue_booking_ticket(text,text,text)', 'execute'),
--             has_function_privilege('anon', 'public._consume_booking_ticket(uuid,uuid)', 'execute');
--
-- 3. Old rows that predate the staff column would sit outside the overlap
--    guard entirely (expect 0):
--      select count(*) from public.appointments
--      where staff_id is null and status = 'booked' and start_at > now();
select count(*) as unguarded_org_level_bookings
from public.appointments
where staff_id is null and status = 'booked' and start_at > now();
