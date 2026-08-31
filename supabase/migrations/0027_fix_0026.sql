-- Fixes for 0026, which is already applied — so this is a follow-up
-- rather than an edit. 0026 cannot be re-run: its leading
-- "drop function public.book_appointment(text, uuid, timestamptz, text,
-- text, uuid, text, text)" names a signature that no longer exists.
--
-- An adversarial review of 0026 raised 33 claims; 21 survived refutation
-- and the ones with a demonstrated failure are fixed here. Each section
-- says what breaks and how it was verified.
--
-- NOTHING in this file changes a function's parameter list or return
-- type, so every function is replaced with "create or replace" and keeps
-- its existing grants. That is deliberate: 0024 taught us that a DROP
-- silently discards grants, and 0026 needed a whole comment block to
-- restate them. The one genuinely new function gets its grants stated in
-- full.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SECURITY — _staff_free_for was callable by anyone.
--
-- 0026's comment claims "No anon/authenticated grant: called only from
-- other security-definer functions". True as far as it goes — but
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, and the
-- revoke that 0013 pairs with the analogous _resource_slots helper
-- (0013:337) was not copied across. Confirmed against production:
--
--   POST /rest/v1/rpc/_staff_free_for  ->  200, "1354eeda-…"
--
-- It is SECURITY DEFINER over memberships, staff_time_off and
-- appointments — none of which grant anon a select policy — and it
-- applies no min-notice, no max-advance and no date bound, so occupancy
-- was probeable for arbitrary past and future windows. Caller-supplied
-- p_org_hours also neutralised the hours filter.
--
-- get_available_slots_chain still reaches it: a SECURITY DEFINER
-- function runs as its owner, so it does not need a grant of its own.
-- This is exactly how get_available_slots still calls _resource_slots.
-- ---------------------------------------------------------------------
revoke all on function public._staff_free_for(uuid, uuid, timestamptz, timestamptz, text, jsonb, uuid) from public;


-- ---------------------------------------------------------------------
-- 2. Phone normalisation, extracted so the conflict guard, the rate
--    limiter and the indexes below all agree on what "same person" means.
--
-- 0026 compared regexp_replace(phone, '\D', '', 'g') on both sides. Two
-- problems:
--
--   * A phone with no ASCII digit at all normalises to ''. customer_phone
--     is only validated as non-blank (0004:23 has no CHECK, and both
--     inputs are bare text fields), so a walk-in entered as "-" matched
--     EVERY other digit-less row. Because the guard is deliberately
--     cross-clinic, one clinic's placeholder blocked an unrelated
--     customer at another clinic. nullif() makes the comparison NULL
--     rather than TRUE, so it correctly does not fire.
--
--   * Postgres '\D' is ASCII-only, so Arabic-Indic ٠٧٩… collapsed to ''
--     as well — a real number reduced to the placeholder case. Folded
--     here before stripping, and applied to the STORED column too, since
--     rows written before today may already hold Arabic-Indic numerals.
--
-- Also folds the country code, so a customer who gives 0791234567 to the
-- clinic and +962791234567 to the website is recognised as one person.
--
-- No "set search_path" on purpose: this is used in an index expression,
-- so it must be IMMUTABLE, and it touches nothing but pg_catalog
-- builtins. It is not SECURITY DEFINER, so it runs as the caller.
-- ---------------------------------------------------------------------
create or replace function public._norm_phone(p_phone text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    case
      when d ~ '^00962' then '0' || substr(d, 6)
      when d ~ '^962'   then '0' || substr(d, 4)
      when d = ''       then ''
      when d ~ '^0'     then d
      else '0' || d
    end, '')
  from (
    select regexp_replace(
             translate(coalesce(p_phone, ''),
                       '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
                       '01234567890123456789'),
             '\D', '', 'g') as d
  ) s;
$$;

revoke all on function public._norm_phone(text) from public;


-- ---------------------------------------------------------------------
-- 3. Indexes for the two cross-clinic scans on the insert path.
--
-- Every existing index on appointments is unusable for the 0026 guard:
-- appointments_org_start_idx and appointments_staff_idx have no qual on
-- their leading columns (the guard is deliberately cross-clinic), and
-- the no_overlap GiST is led by resource_id, which is unconstrained. So
-- book_appointment went from one linear scan (the 0010 rate limiter) to
-- two — multiplied by segment count inside book_appointment_chain.
-- ---------------------------------------------------------------------
create index if not exists appointments_phone_norm_start_idx
  on public.appointments (public._norm_phone(customer_phone), start_at)
  where status = 'booked';

create index if not exists appointments_phone_norm_created_idx
  on public.appointments (public._norm_phone(customer_phone), created_at)
  where status = 'booked';

create index if not exists appointments_customer_user_start_idx
  on public.appointments (customer_user_id, start_at)
  where status = 'booked';


-- ---------------------------------------------------------------------
-- 4. visit_id — a multi-service visit needs one identity.
--
-- book_appointment_chain inserts one row per service, each with its own
-- cancel_token. bookAppointmentChain() kept rows[0] and threw the rest
-- away, reasoning that "the rest are reachable from their bookings
-- list" — but list_my_bookings is granted to authenticated only and
-- filters on auth.uid(), and the public booking page requires no
-- account. So a guest who booked three services held ONE link, and
-- cancelling it cancelled ONE appointment. Two staff members kept
-- holding time for a visit the customer believed was cancelled — which
-- is the exact harm 0026 was written to prevent, reproduced on the new
-- feature's happy path.
--
-- NULL means "this row is the whole visit", so every existing row and
-- every single-service booking is correct as-is and no backfill is
-- needed.
-- ---------------------------------------------------------------------
alter table public.appointments add column if not exists visit_id uuid;

create index if not exists appointments_visit_idx
  on public.appointments (visit_id) where visit_id is not null;


-- ---------------------------------------------------------------------
-- 5. The conflict test itself, extracted so both branches above share
--    one definition. Two single-equality EXISTS clauses, each bounded by
--    start_at so section 3's indexes apply; && stays as the residual so
--    the answer is still exact.
--
-- Created AFTER book_appointment references it, which is fine — PL/pgSQL
-- bodies are not resolved until first execution — but declared here in
-- the same migration so the two can never drift apart.
-- ---------------------------------------------------------------------
create or replace function public._customer_busy(
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
        where public._norm_phone(a.customer_phone) = p_norm_phone
          and a.status = 'booked'
          and a.start_at >= p_start - interval '1 day'
          and a.start_at <  p_end
          and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start, p_end, '[)')
      )
    );
$$;

-- Internal helper. Reached from book_appointment through the owner's
-- privileges, exactly like _resource_slots (0013:337) — no grant, and
-- the revoke that 0026 forgot for _staff_free_for is not forgotten here.
revoke all on function public._customer_busy(text, timestamptz, timestamptz, boolean) from public;


-- ---------------------------------------------------------------------
-- 6. book_appointment — four fixes. Signature unchanged, so grants are
--    preserved and the app's PGRST202 fallback still behaves.
--
-- (a) Business hours were compared with ::time, which discards the date:
--     an appointment ending 02:00 the next day gave 02:00 > 21:00 =
--     false, so it passed. This was unreachable before 0026 because
--     _resource_slots bounds candidates with real timestamp arithmetic,
--     so the UI never offered such a start — but chain segments 2..N are
--     validated only by _staff_free_for, which made it reachable. With
--     the shipped defaults (09:00–21:00, Asia/Amman) a 15-minute consult
--     at 20:45 followed by a long procedure booked a real staff calendar
--     from 21:00 to 02:00, and then silently ate the next morning.
--     Fixed here and in _staff_free_for (section 7); both now compare
--     real instants.
--
--     Note: a clinic whose close is "00:00" now has nothing bookable
--     that day. That already matches _resource_slots (0013:306 computes
--     v_day_end := p_date::timestamp + v_close), so the customer is
--     never offered a slot in the first place. Left consistent rather
--     than fixed in one place only.
--
-- (b) The customer-conflict guard ran BEFORE staff_not_found /
--     outside_business_hours / too_soon. An anonymous caller with a
--     public org slug, a public service id and a bogus p_staff_id got a
--     clean two-valued answer about whether any phone number was busy at
--     any instant, platform-wide, without inserting anything — and so
--     without touching the rate limiter. Moved after the cheap
--     validations in both branches: reaching it now costs a request the
--     clinic would actually accept.
--
-- (c) The guard is split into two single-equality EXISTS clauses and
--     bounded by start_at so the indexes in section 3 can serve it. The
--     && overlap test stays as a residual filter, so the result is
--     still exact. The lower bound must exceed the longest bookable
--     appointment; one day is far beyond any real service.
--
-- (d) The auth.uid() arm matched the CALLER, not the person being
--     booked. On the dashboard auth.uid() is the receptionist, so every
--     manual booking she entered that overlapped her own appointment was
--     flagged — with second-person patient copy — regardless of whose
--     name she typed. It now applies only when the caller is not staff
--     of the org being booked; the phone arm is what covers the front
--     desk, and it still does.
--
-- (e) The rate limiter counted ROWS, so a chain spent one unit per
--     service: segment 7 always raised rate_limited and rolled back the
--     six rows already inserted, telling a customer who made a single
--     request that they were booking too much. Every row written by one
--     transaction shares created_at (transaction_timestamp), so counting
--     distinct created_at counts REQUESTS. A chain of any length costs
--     one; a bot still gets six an hour. Now also keyed on the
--     normalised phone, so spacing the digits no longer resets it.
-- ---------------------------------------------------------------------
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
    order by m.created_at
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
-- 7. _staff_free_for — the same ::time date-loss bug as 5(a). This is
--    the copy that made it reachable, because chain segments 2..N are
--    validated by nothing else. Signature unchanged.
-- ---------------------------------------------------------------------
create or replace function public._staff_free_for(
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
  v_local_date date;
  v_dow text;
  v_day jsonb;
  v_open time;
  v_close time;
begin
  v_local_date := (p_start at time zone p_timezone)::date;
  v_dow := extract(dow from v_local_date)::int::text;

  for c in
    select m.id, coalesce(m.business_hours, p_org_hours) as hours
    from public.memberships m
    where m.org_id = p_org_id
      and (p_staff_id is null or m.id = p_staff_id)
      and (
        not exists (
          select 1 from public.staff_services ss where ss.service_id = p_service_id
        )
        or exists (
          select 1 from public.staff_services ss
          where ss.service_id = p_service_id and ss.staff_membership_id = m.id
        )
      )
    order by m.created_at
  loop
    v_day := c.hours -> v_dow;
    if v_day is null or (v_day ->> 'closed')::boolean then
      continue;
    end if;

    v_open := (v_day ->> 'open')::time;
    v_close := (v_day ->> 'close')::time;
    -- Real instants, not ::time — an end past midnight used to compare
    -- as 02:00 > 21:00 = false and sail through.
    if p_start < (v_local_date + v_open) at time zone p_timezone
       or p_end > (v_local_date + v_close) at time zone p_timezone then
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
      where a.status = 'booked'
        and a.resource_id = c.id
        and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_start, p_end, '[)')
    ) then
      continue;
    end if;

    return c.id;
  end loop;

  return null;
end;
$$;

revoke all on function public._staff_free_for(uuid, uuid, timestamptz, timestamptz, text, jsonb, uuid) from public;


-- ---------------------------------------------------------------------
-- 8. book_appointment_chain — stamp every segment with one visit_id, and
--    bound the request. Signature unchanged.
--
-- The cap is not a policy invention: without it the rate limiter (now
-- one unit per request) no longer bounds how much one call can insert,
-- and toggleService in the wizard is an unbounded toggle. Ten is far
-- above any real visit and far below anything worth worrying about.
-- ---------------------------------------------------------------------
create or replace function public.book_appointment_chain(
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
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'no_services';
  end if;

  v_count := array_length(p_service_ids, 1);
  if v_count > 10 then
    raise exception 'too_many_services';
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


-- ---------------------------------------------------------------------
-- 9. get_booking_by_token — return every segment of the visit, not just
--    the row the token belongs to. Same signature and same return type,
--    so this is a body change only; it now returns N rows for a chained
--    visit and exactly one row for everything else.
--
-- getBookingByToken() in src/lib/availability.ts must stop using
-- .maybeSingle() in the same deploy, or the manage page throws for every
-- multi-service visit.
-- ---------------------------------------------------------------------
create or replace function public.get_booking_by_token(p_cancel_token uuid)
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


-- ---------------------------------------------------------------------
-- 10. cancel_visit_by_token — one link cancels the whole visit.
--
-- cancel_booking_by_token is deliberately left alone: /my and the
-- dashboard both need to cancel a single appointment out of a visit.
-- ---------------------------------------------------------------------
create or replace function public.cancel_visit_by_token(p_cancel_token uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.appointments a
  set status = 'cancelled', updated_at = now()
  where a.status = 'booked'
    and (
      a.cancel_token = p_cancel_token
      or (
        a.visit_id is not null
        and a.visit_id = (
          select v.visit_id from public.appointments v
          where v.cancel_token = p_cancel_token
        )
      )
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.cancel_visit_by_token(uuid) from public;
grant execute on function public.cancel_visit_by_token(uuid) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 11. list_public_staff_for_services — staff who can serve the WHOLE
--     visit.
--
-- The wizard built its staff picker from the first service only
-- (BookingClient.tsx:97), reasoning that anyone who cannot start the
-- visit cannot serve it — a correct necessary condition mistaken for a
-- sufficient one. That staff id was then applied to EVERY segment inside
-- get_available_slots_chain, so picking a dentist who does not also do
-- laser produced an empty slot list on every date, indistinguishable
-- from the clinic being closed. It only bit orgs that actually assign
-- services to staff — i.e. exactly the multi-service audience.
--
-- The "a service with no assignment rows constrains nobody" escape hatch
-- from 0023 is preserved deliberately: a plain intersect would hide
-- everyone from an unassigned service.
--
-- An empty result is legitimate — nobody may perform all the selected
-- services — and means the visit gets split across staff, which is
-- allowed. The UI has to say so rather than silently offering nothing.
-- ---------------------------------------------------------------------
create or replace function public.list_public_staff_for_services(
  p_org_slug text,
  p_service_ids uuid[]
)
returns table (membership_id uuid, name text, title text)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, m.display_name, m.title
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where o.slug = p_org_slug and o.deleted_at is null
    and nullif(trim(coalesce(m.display_name, '')), '') is not null
    and not exists (
      select 1 from unnest(p_service_ids) sid
      where exists (select 1 from public.staff_services ss where ss.service_id = sid)
        and not exists (
          select 1 from public.staff_services ss
          where ss.service_id = sid and ss.staff_membership_id = m.id
        )
    )
  order by m.display_name nulls last, m.created_at;
$$;

revoke all on function public.list_public_staff_for_services(text, uuid[]) from public;
grant execute on function public.list_public_staff_for_services(text, uuid[]) to anon, authenticated;
