-- Nothing reaches the clinic when a booking arrives or is cancelled.
--
-- sendBookingConfirmation() is the only outbound message in the whole
-- app and it emails the CUSTOMER. The notifications table (0024) has
-- exactly one writer: the account-deletion path. So a centre that signs
-- up, shares its link and starts taking bookings finds out by opening
-- the dashboard and looking — which is the opposite of the promise on
-- /partners ("استقبل حجوزاتك ٢٤ ساعة، بدون مكالمات").
--
-- Two events, two mechanisms, for reasons given at each.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. A new kind. The CHECK admitted only 'booking_cancelled'.
-- ---------------------------------------------------------------------
-- Dropped by what it DOES, not by its name. 0024 wrote the check inline
-- on the column, so its name is whatever PostgreSQL generated; naming it
-- here and guessing wrong would either abort the migration or — worse,
-- with `if exists` — leave the old constraint in place and silently
-- reject every 'booking_created' insert the trigger below makes.
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
  check (kind in ('booking_created', 'booking_cancelled'));


-- ---------------------------------------------------------------------
-- 2. One notification per appointment per kind, enforced.
--
-- The account-deletion path in 0024 already inserts 'booking_cancelled'
-- rows itself, and section 4 below adds inserts on the customer-facing
-- cancel paths. Those can never both fire for the same row today, but
-- "can never" is exactly the assumption that produced the last three
-- defects in this schema, and a duplicated notification is the kind of
-- thing nobody notices until a clinic complains about double counting.
--
-- Every insert added here is ON CONFLICT DO NOTHING against this index,
-- so whichever writer gets there first wins and the other is a no-op.
-- 0024's own insert is left untouched: it runs inside its own
-- transaction before anything here can race it.
-- ---------------------------------------------------------------------
create unique index if not exists notifications_appointment_kind_idx
  on public.notifications (appointment_id, kind)
  where appointment_id is not null;


-- ---------------------------------------------------------------------
-- 3. New bookings — a trigger, deliberately, and the first one in this
--    schema.
--
-- The alternative is editing book_appointment, which has two separate
-- INSERT sites (explicit staff and any-staff), and doing it again for
-- every future path that creates an appointment. That function is the
-- single most load-bearing thing in the database and this would be its
-- third rewrite in as many migrations; each one has carried a real
-- defect. A trigger states the rule once, cannot be forgotten by the
-- next insert path, and covers book_appointment_chain and the dashboard's
-- manual booking for free.
--
-- Two things it must never do:
--
--   * Fire for a booking the clinic entered itself. Reception typing a
--     phone booking into the dashboard does not need telling about it.
--     Caller is staff of THIS org -> no notification.
--   * Cost anyone a booking. The insert is wrapped, because an AFTER
--     INSERT trigger that raises aborts the transaction that created the
--     appointment — a failed notification would turn into a failed
--     booking, which is far worse than a missing one.
-- ---------------------------------------------------------------------
create or replace function public._notify_booking_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service text;
  v_tz text;
begin
  -- Seeded/backfilled history and anything not actually on the books.
  if new.status <> 'booked' then
    return new;
  end if;

  if auth.uid() is not null and exists (
    select 1 from public.memberships m
    where m.org_id = new.org_id and m.user_id = auth.uid()
  ) then
    return new;
  end if;

  begin
    select sv.name into v_service from public.services sv where sv.id = new.service_id;
    select s.timezone into v_tz from public.org_settings s where s.org_id = new.org_id;

    insert into public.notifications (org_id, kind, title, body, appointment_id)
    values (
      new.org_id,
      'booking_created',
      new.customer_name,
      coalesce(v_service, '') || ' · '
        || to_char(new.start_at at time zone coalesce(v_tz, 'Asia/Amman'), 'YYYY-MM-DD HH24:MI')
        || ' · ' || new.customer_phone,
      new.id
    )
    on conflict do nothing;
  exception when others then
    -- Never let a notification failure roll back the booking itself.
    null;
  end;

  return new;
end;
$$;

revoke all on function public._notify_booking_created() from public, anon, authenticated;

drop trigger if exists appointments_notify_created on public.appointments;
create trigger appointments_notify_created
  after insert on public.appointments
  for each row execute function public._notify_booking_created();


-- The shared body, so the two cancel paths cannot describe the same
-- event differently. Same wrapping as the trigger: a notification must
-- never turn a successful cancellation into a failed one, which would
-- leave the customer believing they still hold the slot.
create or replace function public._notify_booking_cancelled(
  p_appointment_id uuid,
  p_org_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_start_at timestamptz,
  p_service_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service text;
  v_tz text;
begin
  select sv.name into v_service from public.services sv where sv.id = p_service_id;
  select s.timezone into v_tz from public.org_settings s where s.org_id = p_org_id;

  insert into public.notifications (org_id, kind, title, body, appointment_id)
  values (
    p_org_id,
    'booking_cancelled',
    p_customer_name,
    coalesce(v_service, '') || ' · '
      || to_char(p_start_at at time zone coalesce(v_tz, 'Asia/Amman'), 'YYYY-MM-DD HH24:MI')
      || ' · ' || p_customer_phone,
    p_appointment_id
  )
  on conflict do nothing;
exception when others then
  null;
end;
$$;

revoke all on function public._notify_booking_cancelled(uuid, uuid, text, text, timestamptz, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Customer cancellations — explicit, NOT a trigger.
--
-- A trigger on UPDATE would also fire for the clinic cancelling from its
-- own dashboard (setBookingStatus writes the row directly through
-- PostgREST, so there is no function to hang the rule on), and telling a
-- clinic it just cancelled something is noise. These two functions are
-- the customer-facing cancel paths and nothing else reaches them, so the
-- rule is stated where it is true.
--
-- Both keep their existing signature and return type, so they are
-- replaced in place and keep their grants.
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
  -- Counted in the loop, not with GET DIAGNOSTICS afterwards: row_count
  -- would report the last statement executed inside the loop body.
  for r in
    update public.appointments a
    set status = 'cancelled', updated_at = now()
    where a.cancel_token = p_cancel_token and a.status = 'booked'
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
  v_count int := 0;
  r record;
begin
  for r in
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
      )
    returning a.id, a.org_id, a.customer_name, a.customer_phone, a.start_at, a.service_id
  loop
    perform public._notify_booking_cancelled(r.id, r.org_id, r.customer_name, r.customer_phone, r.start_at, r.service_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;




-- Verify after applying:
--
--   select kind, count(*) from public.notifications group by kind;
--
-- and after making one test booking on the public page, the clinic's
-- dashboard should show a 'booking_created' row for it.
