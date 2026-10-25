-- Session packages (owner, 2026-10-25, item 3 of the roadmap: "باقات
-- الجلسات"). A clinic sells "6 laser sessions for 150" once and the visits
-- draw on it.
--
-- Decided here, and why:
--   * A package covers ONE service. "Six sessions of full-body laser" is
--     the common shape; a package spanning several services would need a
--     rule for which visit costs what, and nobody asked for one.
--   * The catalogue (service_packages) is what the clinic offers; a sale
--     (customer_packages) copies name, service, sessions and the price
--     actually paid, so editing or retiring the catalogue never rewrites a
--     package somebody already bought.
--   * A session is used when the visit is marked completed: a trigger on
--     the status picks the customer's package for that service (soonest to
--     expire first) and records it. Taking the visit back out of completed
--     gives the session back. A no-show does NOT use a session by itself:
--     clinics differ, so the clinic deducts a missed visit by hand from the
--     customer file when its own policy says so.
--   * The clinic can always override from the customer file: take a visit
--     off the package (the row is kept with no package, so the trigger
--     never adds it again), or put a visit on a package by hand.
--   * Money, so that no figure is counted twice:
--       - a package sale is money collected on the day of the sale
--         ("package sales" in the report, refunds on the day of the refund);
--       - a visit drawn from a package is worth price paid / sessions, not
--         the service's list price. "Value of completed visits" therefore
--         keeps meaning what it meant (work delivered) and stays comparable
--         with sales-free months. The two figures are different measures
--         and are labelled as such; they are never added together.
--     One function (_visit_values) defines a visit's worth, and the report,
--     the customer list and the customer file all read it.
--   * A sale needs a customer this clinic has booked (the customer file is
--     where it is sold). Selling covers today's sessions already completed
--     for that service: the usual sale happens at the desk after session 1.
--   * Any member may sell and may move a visit on or off a package (the
--     receptionist does both); the catalogue and cancelling a sale are the
--     owner's. Every write records who did it.
--   * Tables have no grants and no policies; everything goes through the
--     functions below, each scoped by the caller's own membership.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tables. Every reference to another org-scoped row carries org_id in
--    its key (0034/0042), so a row can never point into another clinic.
-- ---------------------------------------------------------------------
-- Added only when missing: once package_redemptions points at it, dropping
-- and re-adding it (the usual idiom) would fail on a second run.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_id_org_key') then
    alter table public.appointments add constraint appointments_id_org_key unique (id, org_id);
  end if;
end;
$$;

create table if not exists public.service_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null,
  name text not null,
  sessions int not null,
  price numeric(12, 3) not null,
  validity_days int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint service_packages_id_org_key unique (id, org_id),
  constraint service_packages_service_same_org foreign key (service_id, org_id)
    references public.services (id, org_id) on delete cascade,
  constraint service_packages_name check (char_length(btrim(name)) between 1 and 80),
  constraint service_packages_sessions check (sessions between 2 and 100),
  constraint service_packages_price check (price >= 0 and price <= 1000000),
  constraint service_packages_validity check (validity_days is null or validity_days between 1 and 1095)
);

create table if not exists public.customer_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone text not null,
  package_id uuid,
  service_id uuid not null,
  name text not null,
  sessions_total int not null,
  price_paid numeric(12, 3) not null,
  sold_at timestamptz not null default now(),
  -- The first instant the package is no longer valid (midnight at the
  -- clinic after its last day). NULL = never expires.
  expires_at timestamptz,
  sold_by uuid references public.memberships(id) on delete set null,
  note text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.memberships(id) on delete set null,
  refund_amount numeric(12, 3),
  constraint customer_packages_id_org_key unique (id, org_id),
  constraint customer_packages_catalogue_same_org foreign key (package_id, org_id)
    references public.service_packages (id, org_id),
  constraint customer_packages_service_same_org foreign key (service_id, org_id)
    references public.services (id, org_id),
  constraint customer_packages_phone check (phone ~ '^0[0-9]{9,10}$'),
  constraint customer_packages_sessions check (sessions_total between 2 and 100),
  constraint customer_packages_price check (price_paid >= 0 and price_paid <= 1000000),
  constraint customer_packages_note check (note is null or char_length(note) <= 500),
  constraint customer_packages_refund check (
    (cancelled_at is null and refund_amount is null)
    or (cancelled_at is not null and refund_amount is not null and refund_amount >= 0 and refund_amount <= price_paid))
);

create index if not exists customer_packages_lookup on public.customer_packages (org_id, phone);
create index if not exists customer_packages_sold on public.customer_packages (org_id, sold_at);

-- One row per visit the clinic has decided about. customer_package_id NULL
-- means "this visit is not from a package" (the clinic took it off), which
-- the trigger respects.
create table if not exists public.package_redemptions (
  appointment_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_package_id uuid,
  auto boolean not null default false,
  created_by uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint package_redemptions_visit_same_org foreign key (appointment_id, org_id)
    references public.appointments (id, org_id) on delete cascade,
  constraint package_redemptions_package_same_org foreign key (customer_package_id, org_id)
    references public.customer_packages (id, org_id) on delete cascade
);

create index if not exists package_redemptions_package on public.package_redemptions (customer_package_id);

alter table public.service_packages enable row level security;
alter table public.customer_packages enable row level security;
alter table public.package_redemptions enable row level security;
revoke all on public.service_packages from anon, authenticated;
revoke all on public.customer_packages from anon, authenticated;
revoke all on public.package_redemptions from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Internal helpers.
-- ---------------------------------------------------------------------

-- What each visit of a clinic is worth: its share of a package when it was
-- drawn from one, otherwise the service's price (NULL = unpriced).
create or replace function public._visit_values(p_org uuid)
returns table (appointment_id uuid, value numeric, customer_package_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select a.id,
         case when cp.id is not null then cp.price_paid / cp.sessions_total else sv.price end,
         cp.id
  from public.appointments a
  left join public.services sv on sv.id = a.service_id
  left join public.package_redemptions pr on pr.appointment_id = a.id
  left join public.customer_packages cp on cp.id = pr.customer_package_id
  where a.org_id = p_org;
$$;

revoke all on function public._visit_values(uuid) from public, anon, authenticated;

-- A clinic's sold packages with their use and state; p_phone NULL = all.
create or replace function public._customer_packages_of(p_org uuid, p_phone text)
returns table (
  id uuid,
  phone text,
  name text,
  service_id uuid,
  service text,
  sessions_total int,
  used int,
  remaining int,
  price_paid numeric,
  sold_at timestamptz,
  expires_at timestamptz,
  sold_by text,
  note text,
  cancelled_at timestamptz,
  refund_amount numeric,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select cp.id, cp.phone, cp.name, cp.service_id, sv.name, cp.sessions_total, u.used,
         greatest(cp.sessions_total - u.used, 0),
         cp.price_paid, cp.sold_at, cp.expires_at, coalesce(m.display_name, ''), cp.note,
         cp.cancelled_at, cp.refund_amount,
         case when cp.cancelled_at is not null then 'cancelled'
              when u.used >= cp.sessions_total then 'used_up'
              when cp.expires_at is not null and cp.expires_at <= now() then 'expired'
              else 'active' end
  from public.customer_packages cp
  left join public.services sv on sv.id = cp.service_id
  left join public.memberships m on m.id = cp.sold_by
  cross join lateral (
    select count(*)::int as used from public.package_redemptions pr where pr.customer_package_id = cp.id
  ) u
  where p_org is not null and cp.org_id = p_org and (p_phone is null or cp.phone = p_phone);
$$;

revoke all on function public._customer_packages_of(uuid, text) from public, anon, authenticated;

create or replace function public._org_tz(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.timezone from public.org_settings s where s.org_id = p_org), 'Asia/Amman');
$$;

revoke all on function public._org_tz(uuid) from public, anon, authenticated;

-- The package a completed visit draws on, locked: same clinic, customer
-- and service, not cancelled, valid on the visit's date, bought no later
-- than the visit's day, with a session left. Soonest to expire first, so
-- nothing lapses while a newer package is being used.
create or replace function public._pick_package(p_org uuid, p_phone text, p_service uuid, p_start timestamptz)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_tz text := public._org_tz(p_org);
  v_id uuid;
  v_total int;
begin
  for v_id, v_total in
    select cp.id, cp.sessions_total
    from public.customer_packages cp
    where cp.org_id = p_org and cp.phone = p_phone and cp.service_id = p_service
      and cp.cancelled_at is null
      and (cp.expires_at is null or p_start < cp.expires_at)
      and p_start >= (date_trunc('day', cp.sold_at at time zone v_tz) at time zone v_tz)
    order by cp.expires_at nulls last, cp.sold_at, cp.id
    for update
  loop
    if (select count(*) from public.package_redemptions pr where pr.customer_package_id = v_id) < v_total then
      return v_id;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public._pick_package(uuid, text, uuid, timestamptz) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. The trigger: a session is used when a visit becomes completed, and
--    given back when it stops being completed.
-- ---------------------------------------------------------------------
create or replace function public._package_on_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg uuid;
begin
  if new.status = 'completed' then
    -- A row already there is the clinic's own decision (a package chosen
    -- by hand, or "not from a package"): leave it.
    if not exists (select 1 from public.package_redemptions pr where pr.appointment_id = new.id) then
      v_pkg := public._pick_package(new.org_id, public._norm_phone(new.customer_phone), new.service_id, new.start_at);
      if v_pkg is not null then
        insert into public.package_redemptions (appointment_id, org_id, customer_package_id, auto)
        values (new.id, new.org_id, v_pkg, true);
      end if;
    end if;
  else
    -- Automatic uses follow the status. A use chosen by hand (say, a
    -- no-show the clinic deducts) stays unless the visit is back to booked
    -- or cancelled, where nothing happened to deduct.
    delete from public.package_redemptions pr
     where pr.appointment_id = new.id
       and pr.customer_package_id is not null
       and (pr.auto or new.status in ('booked', 'cancelled'));
  end if;
  return null;
end;
$$;

revoke all on function public._package_on_status() from public, anon, authenticated;

drop trigger if exists appointments_package_use on public.appointments;
create trigger appointments_package_use
  after update of status on public.appointments
  for each row
  when (old.status is distinct from new.status)
  execute function public._package_on_status();


-- ---------------------------------------------------------------------
-- 4. The catalogue. Read by any member (they sell); written by the owner.
-- ---------------------------------------------------------------------
drop function if exists public.list_service_packages();
create function public.list_service_packages()
returns table (
  id uuid,
  service_id uuid,
  service text,
  name text,
  sessions int,
  price numeric,
  validity_days int,
  active boolean,
  sold int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
begin
  select me.org_id into v_org from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  return query
    select p.id, p.service_id, sv.name, p.name, p.sessions, p.price, p.validity_days, p.active,
           (select count(*)::int from public.customer_packages cp where cp.package_id = p.id)
    from public.service_packages p
    join public.services sv on sv.id = p.service_id
    where p.org_id = v_org
    order by p.active desc, sv.name, p.sessions, p.created_at;
end;
$$;

revoke all on function public.list_service_packages() from public, anon;
grant execute on function public.list_service_packages() to authenticated;

-- p_id NULL adds; otherwise edits. Editing changes future sales only.
drop function if exists public.save_service_package(uuid, uuid, text, int, numeric, int);
create function public.save_service_package(
  p_id uuid,
  p_service_id uuid,
  p_name text,
  p_sessions int,
  p_price numeric,
  p_validity_days int
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
  v_id uuid;
begin
  select me.org_id, me.role into v_org, v_role from public._my_member() me;
  if v_org is null or not coalesce(v_role = 'owner', false) then
    raise exception 'not_authorized';
  end if;
  if not exists (select 1 from public.services s where s.id = p_service_id and s.org_id = v_org) then
    raise exception 'service_not_found';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'package_name';
  end if;
  if not coalesce(p_sessions between 2 and 100, false) then
    raise exception 'package_sessions';
  end if;
  if not coalesce(p_price >= 0 and p_price <= 1000000, false) then
    raise exception 'package_price';
  end if;
  if p_validity_days is not null and not coalesce(p_validity_days between 1 and 1095, false) then
    raise exception 'package_validity';
  end if;

  if p_id is null then
    insert into public.service_packages (org_id, service_id, name, sessions, price, validity_days)
    values (v_org, p_service_id, btrim(p_name), p_sessions, round(p_price, 3), p_validity_days)
    returning id into v_id;
  else
    update public.service_packages p
       set service_id = p_service_id, name = btrim(p_name), sessions = p_sessions,
           price = round(p_price, 3), validity_days = p_validity_days
     where p.id = p_id and p.org_id = v_org
    returning p.id into v_id;
    if v_id is null then
      raise exception 'package_not_found';
    end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_service_package(uuid, uuid, text, int, numeric, int) from public, anon;
grant execute on function public.save_service_package(uuid, uuid, text, int, numeric, int) to authenticated;

drop function if exists public.set_service_package_active(uuid, boolean);
create function public.set_service_package_active(p_id uuid, p_active boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
  v_count int;
begin
  select me.org_id, me.role into v_org, v_role from public._my_member() me;
  if v_org is null or not coalesce(v_role = 'owner', false) then
    raise exception 'not_authorized';
  end if;
  update public.service_packages p set active = coalesce(p_active, false)
   where p.id = p_id and p.org_id = v_org;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'package_not_found';
  end if;
  return coalesce(p_active, false);
end;
$$;

revoke all on function public.set_service_package_active(uuid, boolean) from public, anon;
grant execute on function public.set_service_package_active(uuid, boolean) to authenticated;

-- Deletes a package nobody bought; one that was sold is retired instead
-- (its sales point at it). Returns 'deleted' or 'archived'.
drop function if exists public.delete_service_package(uuid);
create function public.delete_service_package(p_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
  v_count int;
begin
  select me.org_id, me.role into v_org, v_role from public._my_member() me;
  if v_org is null or not coalesce(v_role = 'owner', false) then
    raise exception 'not_authorized';
  end if;
  if not exists (select 1 from public.service_packages p where p.id = p_id and p.org_id = v_org) then
    raise exception 'package_not_found';
  end if;
  if exists (select 1 from public.customer_packages cp where cp.package_id = p_id) then
    update public.service_packages p set active = false where p.id = p_id and p.org_id = v_org;
    return 'archived';
  end if;
  delete from public.service_packages p where p.id = p_id and p.org_id = v_org;
  get diagnostics v_count = row_count;
  return case when v_count > 0 then 'deleted' else 'archived' end;
end;
$$;

revoke all on function public.delete_service_package(uuid) from public, anon;
grant execute on function public.delete_service_package(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Selling, cancelling, and moving a visit on or off a package.
-- ---------------------------------------------------------------------
drop function if exists public.sell_customer_package(text, uuid, numeric, text);
create function public.sell_customer_package(p_phone text, p_package_id uuid, p_price numeric default null, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_me uuid;
  v_phone text := public._norm_phone(p_phone);
  v_pkg public.service_packages%rowtype;
  v_price numeric;
  v_tz text;
  v_day date;
  v_id uuid;
begin
  select me.org_id, me.membership_id into v_org, v_me from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  if not public._is_org_customer(v_org, v_phone) then
    raise exception 'customer_not_found';
  end if;
  select * into v_pkg from public.service_packages p where p.id = p_package_id and p.org_id = v_org;
  if not found or not v_pkg.active then
    raise exception 'package_not_found';
  end if;
  v_price := coalesce(p_price, v_pkg.price);
  if not coalesce(v_price >= 0 and v_price <= 1000000, false) then
    raise exception 'package_price';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'package_note';
  end if;

  v_tz := public._org_tz(v_org);
  v_day := (now() at time zone v_tz)::date;

  insert into public.customer_packages
    (org_id, phone, package_id, service_id, name, sessions_total, price_paid, expires_at, sold_by, note)
  values
    (v_org, v_phone, v_pkg.id, v_pkg.service_id, v_pkg.name, v_pkg.sessions, round(v_price, 3),
     case when v_pkg.validity_days is null then null
          else (v_day + v_pkg.validity_days)::timestamp at time zone v_tz end,
     v_me, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  -- Today's completed sessions of this service that nothing has claimed:
  -- the sale is usually made at the desk right after the first of them.
  insert into public.package_redemptions (appointment_id, org_id, customer_package_id, auto, created_by)
  select a.id, v_org, v_id, true, v_me
  from public.appointments a
  where a.org_id = v_org
    and public._norm_phone(a.customer_phone) = v_phone
    and a.service_id = v_pkg.service_id
    and a.status = 'completed'
    and a.start_at >= (v_day::timestamp at time zone v_tz)
    and a.start_at < ((v_day + 1)::timestamp at time zone v_tz)
    and not exists (select 1 from public.package_redemptions pr where pr.appointment_id = a.id)
  order by a.start_at
  limit v_pkg.sessions;

  return v_id;
end;
$$;

revoke all on function public.sell_customer_package(text, uuid, numeric, text) from public, anon;
grant execute on function public.sell_customer_package(text, uuid, numeric, text) to authenticated;

-- The owner closes a sale, saying how much went back to the customer (0
-- when nothing did). Sessions already used keep their value; no session
-- can be drawn from it afterwards.
drop function if exists public.cancel_customer_package(uuid, numeric);
create function public.cancel_customer_package(p_id uuid, p_refund numeric)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_me uuid;
  v_role text;
  v_cp public.customer_packages%rowtype;
begin
  select me.org_id, me.membership_id, me.role into v_org, v_me, v_role from public._my_member() me;
  if v_org is null or not coalesce(v_role = 'owner', false) then
    raise exception 'not_authorized';
  end if;
  select * into v_cp from public.customer_packages cp where cp.id = p_id and cp.org_id = v_org for update;
  if not found then
    raise exception 'package_not_found';
  end if;
  if v_cp.cancelled_at is not null then
    raise exception 'package_cancelled';
  end if;
  if not coalesce(p_refund >= 0 and p_refund <= v_cp.price_paid, false) then
    raise exception 'package_refund';
  end if;
  update public.customer_packages cp
     set cancelled_at = now(), cancelled_by = v_me, refund_amount = round(p_refund, 3)
   where cp.id = p_id;
  return true;
end;
$$;

revoke all on function public.cancel_customer_package(uuid, numeric) from public, anon;
grant execute on function public.cancel_customer_package(uuid, numeric) to authenticated;

-- p_customer_package_id NULL takes the visit off any package for good;
-- otherwise draws it from that package. Completed or no-show visits only.
drop function if exists public.set_visit_package(uuid, uuid);
create function public.set_visit_package(p_appointment_id uuid, p_customer_package_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_me uuid;
  v_appt public.appointments%rowtype;
  v_cp public.customer_packages%rowtype;
begin
  select me.org_id, me.membership_id into v_org, v_me from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  select * into v_appt from public.appointments a where a.id = p_appointment_id and a.org_id = v_org;
  if not found then
    raise exception 'visit_not_found';
  end if;
  if v_appt.status not in ('completed', 'no_show') then
    raise exception 'visit_not_finished';
  end if;

  if p_customer_package_id is not null then
    select * into v_cp from public.customer_packages cp
     where cp.id = p_customer_package_id and cp.org_id = v_org
     for update;
    if not found
       or v_cp.phone is distinct from public._norm_phone(v_appt.customer_phone)
       or v_cp.service_id is distinct from v_appt.service_id then
      raise exception 'package_not_found';
    end if;
    if v_cp.cancelled_at is not null then
      raise exception 'package_cancelled';
    end if;
    if v_cp.expires_at is not null and v_appt.start_at >= v_cp.expires_at then
      raise exception 'package_expired';
    end if;
    if (select count(*) from public.package_redemptions pr
         where pr.customer_package_id = v_cp.id and pr.appointment_id <> v_appt.id) >= v_cp.sessions_total then
      raise exception 'package_used_up';
    end if;
  end if;

  insert into public.package_redemptions (appointment_id, org_id, customer_package_id, auto, created_by)
  values (v_appt.id, v_org, p_customer_package_id, false, v_me)
  on conflict (appointment_id) do update
    set customer_package_id = excluded.customer_package_id, auto = false,
        created_by = excluded.created_by, created_at = now();
  return true;
end;
$$;

revoke all on function public.set_visit_package(uuid, uuid) from public, anon;
grant execute on function public.set_visit_package(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. Reads for the desk: who holds a usable package (the bookings list
--    and the calendar mark them), what a visit just drew on (said after
--    "completed"), and what the calendar's visits are worth.
-- ---------------------------------------------------------------------
-- In the order _pick_package uses them, so the first row per customer and
-- service is the package the next completed visit will draw on.
drop function if exists public.list_package_holders();
create function public.list_package_holders()
returns table (phone text, service_id uuid, name text, remaining int, expires_at timestamptz, per_session numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
begin
  select me.org_id into v_org from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  return query
    select x.phone, x.service_id, x.name, x.remaining, x.expires_at, x.price_paid / x.sessions_total
    from public._customer_packages_of(v_org, null) x
    where x.status = 'active'
    order by x.expires_at nulls last, x.sold_at, x.id;
end;
$$;

revoke all on function public.list_package_holders() from public, anon;
grant execute on function public.list_package_holders() to authenticated;

drop function if exists public.visit_package_state(uuid);
create function public.visit_package_state(p_appointment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_out jsonb;
begin
  select me.org_id into v_org from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  select jsonb_build_object('name', x.name, 'remaining', x.remaining, 'sessions_total', x.sessions_total)
    into v_out
  from public.package_redemptions pr
  join public._customer_packages_of(v_org, null) x on x.id = pr.customer_package_id
  where pr.appointment_id = p_appointment_id and pr.org_id = v_org;
  return v_out;
end;
$$;

revoke all on function public.visit_package_state(uuid) from public, anon;
grant execute on function public.visit_package_state(uuid) to authenticated;

-- The calendar's day total reads the same worth as the report.
drop function if exists public.list_visit_values(timestamptz, timestamptz);
create function public.list_visit_values(p_from timestamptz, p_to timestamptz)
returns table (appointment_id uuid, value numeric, customer_package_id uuid, package_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
begin
  select me.org_id into v_org from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > interval '45 days' then
    raise exception 'bad_period';
  end if;
  return query
    select vv.appointment_id, vv.value, vv.customer_package_id, cp.name
    from public.appointments a
    join public._visit_values(v_org) vv on vv.appointment_id = a.id
    left join public.customer_packages cp on cp.id = vv.customer_package_id
    where a.org_id = v_org and a.start_at >= p_from and a.start_at < p_to;
end;
$$;

revoke all on function public.list_visit_values(timestamptz, timestamptz) from public, anon;
grant execute on function public.list_visit_values(timestamptz, timestamptz) to authenticated;


-- ---------------------------------------------------------------------
-- 7. The customer list (0062) values visits through _visit_values and
--    counts usable packages. Same body otherwise.
-- ---------------------------------------------------------------------
drop function if exists public.list_org_customers(text, int, int);
create function public.list_org_customers(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (
  phone text,
  name text,
  email text,
  completed int,
  no_shows int,
  cancelled int,
  upcoming int,
  first_visit timestamptz,
  last_visit timestamptz,
  next_visit timestamptz,
  total_value numeric,
  tags text[],
  notes int,
  packages int,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text;
begin
  select me.org_id into v_org from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  -- Digits typed in the search (any script) match inside the number.
  v_digits := nullif(regexp_replace(translate(coalesce(v_search, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g'), '');

  return query
    with per as (
      select public._norm_phone(a.customer_phone) as p,
             (array_agg(a.customer_name order by a.start_at desc))[1] as nm,
             (array_agg(a.customer_email order by a.start_at desc) filter (where a.customer_email is not null))[1] as em,
             count(*) filter (where a.status = 'completed')::int as done,
             count(*) filter (where a.status = 'no_show')::int as ns,
             count(*) filter (where a.status = 'cancelled')::int as cx,
             count(*) filter (where a.status = 'booked' and a.start_at > now())::int as up,
             min(a.start_at) filter (where a.status = 'completed') as first_at,
             max(a.start_at) filter (where a.status = 'completed') as last_at,
             min(a.start_at) filter (where a.status = 'booked' and a.start_at > now()) as next_at,
             coalesce(sum(vv.value) filter (where a.status = 'completed'), 0) as val,
             max(a.start_at) as activity
      from public.appointments a
      left join public._visit_values(v_org) vv on vv.appointment_id = a.id
      where a.org_id = v_org and a.customer_phone is not null
      group by 1
    ),
    pk as (
      select x.phone as p, count(*)::int as n
      from public._customer_packages_of(v_org, null) x
      where x.status = 'active'
      group by 1
    )
    select per.p, per.nm, per.em, per.done, per.ns, per.cx, per.up,
           per.first_at, per.last_at, per.next_at, per.val,
           coalesce(f.tags, '{}'::text[]),
           (select count(*)::int from public.customer_notes n where n.org_id = v_org and n.phone = per.p),
           coalesce(pk.n, 0),
           count(*) over ()
    from per
    left join public.customer_files f on f.org_id = v_org and f.phone = per.p
    left join pk on pk.p = per.p
    where per.p is not null
      and (v_search is null
           or per.nm ilike '%' || v_search || '%'
           or (v_digits is not null and per.p like '%' || v_digits || '%')
           or exists (select 1 from unnest(f.tags) t where t ilike '%' || v_search || '%'))
    order by per.activity desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.list_org_customers(text, int, int) from public, anon;
grant execute on function public.list_org_customers(text, int, int) to authenticated;


-- ---------------------------------------------------------------------
-- 8. The customer file (0062) gains the packages, the catalogue to sell
--    from, and each visit's package and value.
-- ---------------------------------------------------------------------
drop function if exists public.get_org_customer(text);
create function public.get_org_customer(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.get_org_customer(text) from public, anon;
grant execute on function public.get_org_customer(text) to authenticated;


-- ---------------------------------------------------------------------
-- 9. org_report (0060): visits valued through _visit_values, and a new
--    'packages' section. The rest is unchanged.
-- ---------------------------------------------------------------------
create or replace function public.org_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_tz text;
  v_days int;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_start timestamptz;
  v_totals jsonb;
  v_previous jsonb;
  v_money jsonb;
  v_services jsonb;
  v_staff jsonb;
  v_series jsonb;
  v_customers jsonb;
  v_sources jsonb;
  v_packages jsonb;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'report_bad_period';
  end if;

  select coalesce(s.timezone, 'Asia/Amman') into v_tz
  from public.org_settings s where s.org_id = v_org;
  v_tz := coalesce(v_tz, 'Asia/Amman');

  v_days := p_to - p_from + 1;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;
  v_prev_start := (p_from - v_days)::timestamp at time zone v_tz;

  select jsonb_build_object(
           'total',     count(*),
           'booked',    count(*) filter (where a.status = 'booked'),
           'completed', count(*) filter (where a.status = 'completed'),
           'cancelled', count(*) filter (where a.status = 'cancelled'),
           'no_show',   count(*) filter (where a.status = 'no_show'))
    into v_totals
  from public.appointments a
  where a.org_id = v_org and a.start_at >= v_start and a.start_at < v_end;

  select jsonb_build_object(
           'total',     count(*),
           'completed', count(*) filter (where a.status = 'completed'),
           'no_show',   count(*) filter (where a.status = 'no_show'))
    into v_previous
  from public.appointments a
  where a.org_id = v_org and a.start_at >= v_prev_start and a.start_at < v_start;

  -- Completed visits only: a booking that has not happened yet is not
  -- money, and a cancelled one never was. A visit drawn from a package is
  -- worth its share of the package (0063).
  select jsonb_build_object(
           'completed_value', coalesce(sum(vv.value), 0),
           'priced',          count(*) filter (where vv.value is not null),
           'unpriced',        count(*) filter (where vv.value is null),
           'from_packages',   count(*) filter (where vv.customer_package_id is not null),
           'previous_value',  (
             select coalesce(sum(vv2.value), 0)
             from public.appointments a2
             join public._visit_values(v_org) vv2 on vv2.appointment_id = a2.id
             where a2.org_id = v_org and a2.status = 'completed'
               and a2.start_at >= v_prev_start and a2.start_at < v_start
           ))
    into v_money
  from public.appointments a
  join public._visit_values(v_org) vv on vv.appointment_id = a.id
  where a.org_id = v_org and a.status = 'completed'
    and a.start_at >= v_start and a.start_at < v_end;

  select coalesce(jsonb_agg(x order by x.total desc, x.name), '[]'::jsonb)
    into v_services
  from (
    select sv.id as service_id, sv.name,
           count(*) as total,
           count(*) filter (where a.status = 'completed') as completed,
           count(*) filter (where a.status = 'no_show') as no_show,
           coalesce(sum(vv.value) filter (where a.status = 'completed'), 0) as value
    from public.appointments a
    join public.services sv on sv.id = a.service_id
    join public._visit_values(v_org) vv on vv.appointment_id = a.id
    where a.org_id = v_org and a.start_at >= v_start and a.start_at < v_end
    group by sv.id, sv.name
  ) x;

  select coalesce(jsonb_agg(x order by x.total desc), '[]'::jsonb)
    into v_staff
  from (
    select a.staff_id,
           count(*) as total,
           count(*) filter (where a.status = 'completed') as completed,
           count(*) filter (where a.status = 'no_show') as no_show,
           coalesce(sum(vv.value) filter (where a.status = 'completed'), 0) as value
    from public.appointments a
    join public._visit_values(v_org) vv on vv.appointment_id = a.id
    where a.org_id = v_org and a.start_at >= v_start and a.start_at < v_end
    group by a.staff_id
  ) x;

  -- Returning is judged on the phone number, which is the only identity a
  -- guest booking has: first visit ever at this clinic, or not.
  select jsonb_build_object(
           'people', count(*),
           'new', count(*) filter (where x.first_at >= v_start))
    into v_customers
  from (
    select public._norm_phone(a.customer_phone) as phone,
           min(first_seen.first_at) as first_at
    from public.appointments a
    join lateral (
      select min(b.start_at) as first_at
      from public.appointments b
      where b.org_id = v_org
        and public._norm_phone(b.customer_phone) = public._norm_phone(a.customer_phone)
    ) first_seen on true
    where a.org_id = v_org
      and a.start_at >= v_start and a.start_at < v_end
      and a.customer_phone is not null
    group by 1
  ) x;

  with days as (
    select g::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g
  ),
  counted as (
    select (a.start_at at time zone v_tz)::date as day,
           count(*) as total,
           count(*) filter (where a.status = 'completed') as completed,
           count(*) filter (where a.status = 'no_show') as no_show,
           coalesce(sum(vv.value) filter (where a.status = 'completed'), 0) as value
    from public.appointments a
    join public._visit_values(v_org) vv on vv.appointment_id = a.id
    where a.org_id = v_org and a.start_at >= v_start and a.start_at < v_end
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day', d.day,
           'total', coalesce(c.total, 0),
           'completed', coalesce(c.completed, 0),
           'no_show', coalesce(c.no_show, 0),
           'value', coalesce(c.value, 0)) order by d.day), '[]'::jsonb)
    into v_series
  from days d
  left join counted c on c.day = d.day;

  -- Where the period's bookings came from (0060). Same rows and same
  -- window as 'totals', so the share of QR bookings is a fraction of the
  -- very number the page already shows.
  select jsonb_build_object(
           'qr', count(*) filter (where a.booking_source = 'qr'),
           'qr_previous', (
             select count(*) from public.appointments b
             where b.org_id = v_org and b.booking_source = 'qr'
               and b.start_at >= v_prev_start and b.start_at < v_start))
    into v_sources
  from public.appointments a
  where a.org_id = v_org and a.start_at >= v_start and a.start_at < v_end;

  -- Package money (0063), on the day it moved: sales on the day of sale,
  -- refunds on the day of cancellation. A different measure from the
  -- value of completed visits; never added to it.
  select jsonb_build_object(
           'catalogue', (select count(*) from public.service_packages p where p.org_id = v_org),
           'sold', (select count(*) from public.customer_packages cp
                    where cp.org_id = v_org and cp.sold_at >= v_start and cp.sold_at < v_end),
           'sold_value', (select coalesce(sum(cp.price_paid), 0) from public.customer_packages cp
                          where cp.org_id = v_org and cp.sold_at >= v_start and cp.sold_at < v_end),
           'refunded', (select coalesce(sum(cp.refund_amount), 0) from public.customer_packages cp
                        where cp.org_id = v_org and cp.cancelled_at >= v_start and cp.cancelled_at < v_end),
           'previous_sold_value', (select coalesce(sum(cp.price_paid), 0) from public.customer_packages cp
                                   where cp.org_id = v_org and cp.sold_at >= v_prev_start and cp.sold_at < v_start))
    into v_packages;

  return jsonb_build_object(
    'generated_at', now(),
    'timezone', v_tz,
    'from', p_from,
    'to', p_to,
    'totals', v_totals,
    'previous', v_previous,
    'money', v_money,
    'by_service', v_services,
    'by_staff', v_staff,
    'customers', v_customers,
    'series', v_series,
    'sources', v_sources,
    'packages', v_packages);
end;
$$;

-- Same signature as 0054, so CREATE OR REPLACE keeps its grants; restated
-- so this file stands on its own.
revoke all on function public.org_report(date, date) from public, anon;
grant execute on function public.org_report(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select count(*) from information_schema.tables where table_name in ('service_packages','customer_packages','package_redemptions');  -- 3
-- select count(*) from pg_trigger where tgname = 'appointments_package_use';                                                           -- 1
-- select has_table_privilege('authenticated', 'public.customer_packages', 'select');                                                  -- false
-- select has_function_privilege('anon', 'public.sell_customer_package(text,uuid,numeric,text)', 'execute');                          -- false
