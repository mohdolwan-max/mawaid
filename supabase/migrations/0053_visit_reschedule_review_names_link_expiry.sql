-- The four remaining findings from the 2026-09-20 audit, with the owner's
-- answers: warn on time off over bookings, move the WHOLE visit, publish
-- the first name only, and let a manage link expire.
--
--   1. add_staff_time_off inserted over existing bookings in silence, so a
--      staff member could have a day off with patients still on it and
--      nobody was told. It now reports how many bookings it covers; the
--      page shows that. Deliberately NOT a refusal: the clinic knows about
--      its own day off, it just needs to see what to move.
--   2. Rescheduling by the customer link moved only the segment the link
--      pointed at, leaving the rest of a multi-service visit at the old
--      time — and because the segments sit on different staff, the overlap
--      constraint did not object. The whole visit now moves together,
--      keeping the gaps between its services.
--   3. reviews.customer_name was the full name typed at booking, published
--      on a public page, which the customer was never told. Only the first
--      name is stored now, and the names already published are trimmed.
--   4. A cancel token worked for ever: years after the visit it still
--      opened the booking, cancelled it and rescheduled it. Links now stop
--      30 days after the appointment, which still leaves room to review.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Time off says what it covers.
-- ---------------------------------------------------------------------
drop function if exists public.add_staff_time_off(uuid, timestamptz, timestamptz, text);
create function public.add_staff_time_off(
  p_membership_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text default null
)
returns table (id uuid, conflicts int)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org_id uuid;
  v_id uuid;
  v_conflicts int;
begin
  select org_id into v_org_id from public.memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'staff_not_found';
  end if;
  if not (
    public.is_org_owner(v_org_id)
    or exists (select 1 from public.memberships m where m.id = p_membership_id and m.user_id = auth.uid())
  ) then
    raise exception 'not_authorized';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'invalid_range';
  end if;

  -- Counted BEFORE the insert, so the number is what the clinic has to
  -- deal with, not what the time off caused.
  select count(*)::int into v_conflicts
  from public.appointments a
  where a.staff_id = p_membership_id
    and a.status = 'booked'
    and tstzrange(a.start_at, a.end_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  insert into public.staff_time_off (org_id, staff_membership_id, starts_at, ends_at, reason)
  values (v_org_id, p_membership_id, p_starts_at, p_ends_at, nullif(trim(coalesce(p_reason, '')), ''))
  returning staff_time_off.id into v_id;

  return query select v_id, v_conflicts;
end;
$$;

revoke all on function public.add_staff_time_off(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function public.add_staff_time_off(uuid, timestamptz, timestamptz, text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. How long a manage link lives.
-- ---------------------------------------------------------------------
-- 30 days past the appointment: long enough to leave a review (which is
-- the only thing a customer still does with the link afterwards), short
-- enough that a forwarded or logged link stops being a live capability.
create or replace function public._booking_link_live(p_start_at timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$
  select p_start_at > now() - interval '30 days';
$$;

revoke all on function public._booking_link_live(timestamptz) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Reading a booking by its link.
-- ---------------------------------------------------------------------
create or replace function public.get_booking_by_token(p_cancel_token uuid)
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
  where (
      a.cancel_token = p_cancel_token
      or (
        a.visit_id is not null
        and a.visit_id = (
          select v.visit_id from public.appointments v
          where v.cancel_token = p_cancel_token
        )
      )
    )
    -- Expiry is judged on the row the link belongs to, so every segment of
    -- a visit disappears together with it.
    and public._booking_link_live((
      select t.start_at from public.appointments t where t.cancel_token = p_cancel_token
    ))
  order by a.start_at;
$$;

revoke all on function public.get_booking_by_token(uuid) from public, anon, authenticated;
grant execute on function public.get_booking_by_token(uuid) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Cancelling by link: same expiry.
-- ---------------------------------------------------------------------
create or replace function public.cancel_booking_by_token(p_cancel_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  r record;
begin
  for r in
    update public.appointments a
    set status = 'cancelled', updated_at = now()
    where a.cancel_token = p_cancel_token
      and a.status = 'booked'
      and public._booking_link_live(a.start_at)
    returning a.id, a.org_id, a.customer_name, a.customer_phone, a.start_at, a.service_id
  loop
    perform public._notify_booking_cancelled(r.id, r.org_id, r.customer_name, r.customer_phone, r.start_at, r.service_id);
    v_count := v_count + 1;
  end loop;

  return v_count > 0;
end;
$$;

create or replace function public.cancel_visit_by_token(p_cancel_token uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit uuid;
  v_start timestamptz;
  v_count int := 0;
  r record;
begin
  select a.visit_id, a.start_at into v_visit, v_start
  from public.appointments a
  where a.cancel_token = p_cancel_token;

  if v_start is null or not public._booking_link_live(v_start) then
    return 0;
  end if;

  for r in
    update public.appointments a
    set status = 'cancelled', updated_at = now()
    where a.status = 'booked'
      and (
        a.cancel_token = p_cancel_token
        or (v_visit is not null and a.visit_id = v_visit)
      )
    returning a.id, a.org_id, a.customer_name, a.customer_phone, a.start_at, a.service_id
  loop
    perform public._notify_booking_cancelled(r.id, r.org_id, r.customer_name, r.customer_phone, r.start_at, r.service_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;


-- ---------------------------------------------------------------------
-- 5. Rescheduling by link moves the whole visit.
-- ---------------------------------------------------------------------
-- Every segment shifts by the same amount, so a 15:00 / 15:30 / 16:00
-- visit moved to 17:00 becomes 17:00 / 17:30 / 18:00 — the gaps the
-- clinic planned are part of the visit, not an accident.
--
-- Order matters: moving later, the LAST segment goes first, otherwise it
-- would be asked to sit on top of a sibling that has not moved yet and the
-- exclusion constraint would refuse. Moving earlier, the first one leads.
-- _reschedule re-checks hours, notice, time off and overlap for each
-- segment, and any refusal rolls the whole visit back.
create or replace function public.reschedule_booking_by_token(
  p_cancel_token uuid,
  p_start_at timestamptz
)
returns table (id uuid, start_at timestamptz, end_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_visit uuid;
  v_token_start timestamptz;
  v_first timestamptz;
  v_delta interval;
  r record;
begin
  select a.id, a.visit_id, a.start_at into v_id, v_visit, v_token_start
  from public.appointments a
  where a.cancel_token = p_cancel_token;

  if v_id is null then
    raise exception 'booking_not_found';
  end if;
  if not public._booking_link_live(v_token_start) then
    raise exception 'booking_link_expired';
  end if;

  select min(a.start_at) into v_first
  from public.appointments a
  where a.status = 'booked'
    and (a.id = v_id or (v_visit is not null and a.visit_id = v_visit));

  if v_first is null then
    raise exception 'booking_not_active';
  end if;

  v_delta := p_start_at - v_first;

  for r in
    select a.id as appointment_id, a.start_at as old_start
    from public.appointments a
    where a.status = 'booked'
      and (a.id = v_id or (v_visit is not null and a.visit_id = v_visit))
    order by case when v_delta > interval '0' then -extract(epoch from a.start_at)
                  else extract(epoch from a.start_at) end
  loop
    perform 1 from public._reschedule(r.appointment_id, r.old_start + v_delta);
  end loop;

  return query
    select a.id, a.start_at, a.end_at
    from public.appointments a
    where a.id = v_id or (v_visit is not null and a.visit_id = v_visit)
    order by a.start_at;
end;
$$;

revoke all on function public.reschedule_booking_by_token(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.reschedule_booking_by_token(uuid, timestamptz) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. Reviews carry a first name, and only while the link is alive.
-- ---------------------------------------------------------------------
create or replace function public.can_review(p_cancel_token uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    where a.cancel_token = p_cancel_token
      and a.status = 'completed'
      and public._booking_link_live(a.start_at)
      and not exists (select 1 from public.reviews r where r.appointment_id = a.id)
  );
$$;

create or replace function public.submit_review(
  p_cancel_token uuid,
  p_rating int,
  p_comment text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment_id uuid;
  v_org_id uuid;
  v_status text;
  v_customer_name text;
  v_start_at timestamptz;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating';
  end if;

  select a.id, a.org_id, a.status, a.customer_name, a.start_at
  into v_appointment_id, v_org_id, v_status, v_customer_name, v_start_at
  from public.appointments a
  where a.cancel_token = p_cancel_token;

  if v_appointment_id is null then
    raise exception 'booking_not_found';
  end if;
  if not public._booking_link_live(v_start_at) then
    raise exception 'booking_link_expired';
  end if;
  if v_status <> 'completed' then
    raise exception 'not_completed';
  end if;
  if exists (select 1 from public.reviews r where r.appointment_id = v_appointment_id) then
    raise exception 'already_reviewed';
  end if;

  -- First name only: the customer typed this name to be called at the
  -- clinic, not to be published next to their opinion.
  insert into public.reviews (org_id, appointment_id, rating, comment, customer_name)
  values (v_org_id, v_appointment_id, p_rating, nullif(trim(coalesce(p_comment, '')), ''),
          split_part(btrim(v_customer_name), ' ', 1));

  return true;
end;
$$;

-- The names already on public pages, trimmed the same way.
update public.reviews
   set customer_name = split_part(btrim(customer_name), ' ', 1)
 where customer_name is not null
   and btrim(customer_name) <> split_part(btrim(customer_name), ' ', 1);


-- ---------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------
-- 1. No published review carries more than one word (expect 0):
--      select count(*) from public.reviews where customer_name like '% %';
--
-- 2. A link older than 30 days is dead (expect false):
--      select public._booking_link_live(now() - interval '31 days');
--
-- 3. Time off now answers with its conflict count:
--      select * from public.add_staff_time_off(
--        '00000000-0000-0000-0000-000000000000', now(), now() + interval '1 hour', 'test');
--      -- expect: staff_not_found
select count(*) as reviews_with_full_name
from public.reviews
where customer_name like '% %';
