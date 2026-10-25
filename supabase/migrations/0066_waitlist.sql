-- The waitlist (owner, 2026-10-25, item 6 of the roadmap: "قائمة الانتظار").
--
-- A customer who finds no free time on the day they want leaves a name and
-- a number (and an email if they like). When a booked time on that day is
-- given up, everyone waiting for it is told, and whoever books first has
-- it. The clinic sees the list, can see at a glance whether a time is free
-- now, and can call, message or book the customer itself.
--
-- Decided here, and why:
--   * One entry per customer per clinic per day. A customer asking again
--     for the same day updates their entry instead of queueing twice.
--   * A time "opens" when a FUTURE booked appointment is cancelled, moved
--     to another time, or moved to another specialist. Those are marked on
--     the entries for that day by a trigger, whichever screen made the
--     change; nothing depends on remembering to call something.
--   * The entries woken are those for that day whose specialist is the
--     one freed, or who did not ask for one. The service is not compared:
--     a freed half hour may well fit another service, and the email says a
--     time MAY be free and links to the real availability, which decides.
--   * Email is the only message the platform sends a customer for this
--     (owner: the platform's only SMS is the booking code, 0058; WhatsApp
--     waits for Meta). Without an email, the clinic sees "a time opened"
--     on the entry and contacts the customer itself.
--   * A customer who books that day leaves the list by themselves (a
--     trigger on new appointments). An entry for a day gone by is simply
--     no longer shown; nothing is deleted.
--   * Joining is public but only through our server (booking_secret, as
--     the ticket in 0051), within the clinic's booking window, at most
--     three open days per number per clinic and ten new entries a day per
--     visitor, so the list cannot be flooded.
--   * The table has no grants and no policies; the clinic reads and
--     removes through functions scoped by the caller's own membership.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------
create table if not exists public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- The visit asked for, as the booking wizard carries it. Checked
  -- against the clinic's own services on entry (an array cannot carry a
  -- foreign key).
  service_ids uuid[] not null,
  staff_id uuid,
  day date not null,
  customer_name text not null,
  phone text not null,
  email text,
  lang text not null default 'ar',
  source_hash text,
  status text not null default 'waiting',
  -- Last time a booked time on that day was given up, and last time the
  -- customer was emailed about it.
  freed_at timestamptz,
  notified_at timestamptz,
  removed_by uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint waitlist_staff_same_org foreign key (staff_id, org_id)
    references public.memberships (id, org_id) on delete cascade,
  constraint waitlist_services check (cardinality(service_ids) between 1 and 10),
  constraint waitlist_name check (char_length(btrim(customer_name)) between 1 and 80),
  constraint waitlist_phone check (phone ~ '^07[0-9]{8}$' or phone ~ '^01[0-9]{9}$'),
  constraint waitlist_email check (email is null or (char_length(email) <= 200 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  constraint waitlist_lang check (lang in ('ar', 'en')),
  constraint waitlist_status check (status in ('waiting', 'booked', 'removed'))
);

create unique index if not exists waitlist_one_per_day
  on public.waitlist_entries (org_id, phone, day) where status = 'waiting';
create index if not exists waitlist_org_day on public.waitlist_entries (org_id, day) where status = 'waiting';
create index if not exists waitlist_source on public.waitlist_entries (source_hash, created_at);

alter table public.waitlist_entries enable row level security;
revoke all on public.waitlist_entries from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Joining, from the public booking page through our server.
-- ---------------------------------------------------------------------
drop function if exists public.join_waitlist(text, text, uuid[], uuid, date, text, text, text, text, text);
create function public.join_waitlist(
  p_secret text,
  p_org_slug text,
  p_service_ids uuid[],
  p_staff_id uuid,
  p_day date,
  p_name text,
  p_phone text,
  p_email text,
  p_lang text,
  p_source_hash text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_closed boolean;
  v_tz text;
  v_max int;
  v_today date;
  v_phone text := public._norm_phone(p_phone);
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_ids uuid[];
  v_id uuid;
begin
  if not public._booking_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;

  select o.id, public._org_closed(o.deleted_at, o.plan_expires_at)
    into v_org, v_closed
  from public.organizations o where o.slug = p_org_slug;
  if v_org is null or coalesce(v_closed, true) then
    raise exception 'org_not_found';
  end if;

  -- Distinct, in the customer's order, every one an active service here.
  select coalesce(array_agg(x.id order by x.pos), '{}')
    into v_ids
  from (
    select s.id, min(u.pos) as pos
    from unnest(coalesce(p_service_ids, '{}'::uuid[])) with ordinality as u(id, pos)
    join public.services s on s.id = u.id and s.org_id = v_org and s.active
    group by s.id
  ) x;
  if cardinality(v_ids) = 0 or cardinality(v_ids) > 10
     or cardinality(v_ids) <> (select count(distinct u) from unnest(p_service_ids) u) then
    raise exception 'service_not_found';
  end if;
  if p_staff_id is not null
     and not exists (select 1 from public.memberships m where m.id = p_staff_id and m.org_id = v_org) then
    raise exception 'staff_not_found';
  end if;

  select coalesce(s.timezone, 'Asia/Amman'), coalesce(s.max_advance_days, 30)
    into v_tz, v_max
  from public.org_settings s where s.org_id = v_org;
  v_tz := coalesce(v_tz, 'Asia/Amman');
  v_max := coalesce(v_max, 30);
  v_today := (now() at time zone v_tz)::date;
  if p_day is null or p_day < v_today or p_day > v_today + v_max then
    raise exception 'waitlist_bad_day';
  end if;

  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'waitlist_name';
  end if;
  if v_phone is null or not (v_phone ~ '^07[0-9]{8}$' or v_phone ~ '^01[0-9]{9}$') then
    raise exception 'waitlist_phone';
  end if;
  if v_email is not null and not (char_length(v_email) <= 200 and v_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'waitlist_email';
  end if;

  -- Asking again for the same day updates the entry.
  select w.id into v_id
  from public.waitlist_entries w
  where w.org_id = v_org and w.phone = v_phone and w.day = p_day and w.status = 'waiting'
  for update;
  if v_id is not null then
    update public.waitlist_entries w
       set service_ids = v_ids, staff_id = p_staff_id, customer_name = btrim(p_name),
           email = v_email, lang = case when p_lang = 'en' then 'en' else 'ar' end, updated_at = now()
     where w.id = v_id;
    return v_id;
  end if;

  if (select count(*) from public.waitlist_entries w
      where w.org_id = v_org and w.phone = v_phone and w.status = 'waiting' and w.day >= v_today) >= 3 then
    raise exception 'waitlist_limit';
  end if;
  if p_source_hash is not null
     and (select count(*) from public.waitlist_entries w
          where w.source_hash = p_source_hash and w.created_at > now() - interval '1 day') >= 10 then
    raise exception 'waitlist_limit';
  end if;

  insert into public.waitlist_entries
    (org_id, service_ids, staff_id, day, customer_name, phone, email, lang, source_hash)
  values
    (v_org, v_ids, p_staff_id, p_day, btrim(p_name), v_phone, v_email,
     case when p_lang = 'en' then 'en' else 'ar' end, p_source_hash)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.join_waitlist(text, text, uuid[], uuid, date, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.join_waitlist(text, text, uuid[], uuid, date, text, text, text, text, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Triggers: a time given up wakes the day's entries; a booking made
--    by a waiting customer for that day takes them off the list.
-- ---------------------------------------------------------------------
create or replace function public._waitlist_on_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  if tg_op = 'INSERT' then
    if new.status = 'booked' then
      v_tz := public._org_tz(new.org_id);
      update public.waitlist_entries w
         set status = 'booked', updated_at = now()
       where w.org_id = new.org_id
         and w.status = 'waiting'
         and w.phone = public._norm_phone(new.customer_phone)
         and w.day = (new.start_at at time zone v_tz)::date;
    end if;
    return null;
  end if;

  -- UPDATE: only a future booked time that stops being held at that
  -- moment by that person opens anything.
  if old.status = 'booked' and old.start_at > now()
     and (new.status = 'cancelled'
          or (new.status = 'booked'
              and (new.start_at is distinct from old.start_at or new.staff_id is distinct from old.staff_id))) then
    v_tz := public._org_tz(old.org_id);
    update public.waitlist_entries w
       set freed_at = now(), updated_at = now()
     where w.org_id = old.org_id
       and w.status = 'waiting'
       and w.day = (old.start_at at time zone v_tz)::date
       and (w.staff_id is null or old.staff_id is null or w.staff_id = old.staff_id);
  end if;
  return null;
end;
$$;

revoke all on function public._waitlist_on_change() from public, anon, authenticated;

drop trigger if exists appointments_waitlist_insert on public.appointments;
create trigger appointments_waitlist_insert
  after insert on public.appointments
  for each row execute function public._waitlist_on_change();

drop trigger if exists appointments_waitlist_update on public.appointments;
create trigger appointments_waitlist_update
  after update of status, start_at, staff_id on public.appointments
  for each row execute function public._waitlist_on_change();


-- ---------------------------------------------------------------------
-- 4. The clinic's list, and removing an entry. Any member.
-- ---------------------------------------------------------------------
drop function if exists public.list_waitlist();
create function public.list_waitlist()
returns table (
  id uuid,
  day date,
  service_ids uuid[],
  service_names text[],
  staff_id uuid,
  customer_name text,
  phone text,
  email text,
  created_at timestamptz,
  freed_at timestamptz,
  notified_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_today date;
begin
  select me.org_id into v_org from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  v_today := (now() at time zone public._org_tz(v_org))::date;
  return query
    select w.id, w.day, w.service_ids,
           array(select s.name from unnest(w.service_ids) with ordinality u(sid, pos)
                 join public.services s on s.id = u.sid order by u.pos),
           w.staff_id, w.customer_name, w.phone, w.email, w.created_at, w.freed_at, w.notified_at
    from public.waitlist_entries w
    where w.org_id = v_org and w.status = 'waiting' and w.day >= v_today
    order by w.day, w.created_at;
end;
$$;

revoke all on function public.list_waitlist() from public, anon;
grant execute on function public.list_waitlist() to authenticated;

drop function if exists public.remove_waitlist_entry(uuid);
create function public.remove_waitlist_entry(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_me uuid;
  v_count int;
begin
  select me.org_id, me.membership_id into v_org, v_me from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  update public.waitlist_entries w
     set status = 'removed', removed_by = v_me, updated_at = now()
   where w.id = p_id and w.org_id = v_org and w.status = 'waiting';
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'waitlist_not_found';
  end if;
  return true;
end;
$$;

revoke all on function public.remove_waitlist_entry(uuid) from public, anon;
grant execute on function public.remove_waitlist_entry(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5. The emails due: entries with an email whose day still lies ahead and
--    a time opened since the last email (at most one every 30 minutes, so
--    a clinic shuffling its diary does not flood anyone). Claimed and
--    stamped in one step; our server only.
-- ---------------------------------------------------------------------
drop function if exists public.claim_waitlist_notices(text);
create function public.claim_waitlist_notices(p_secret text)
returns table (
  id uuid,
  email text,
  customer_name text,
  lang text,
  day date,
  service_ids uuid[],
  org_name text,
  org_slug text,
  timezone text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public._booking_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;
  return query
    with due as (
      select w.id
      from public.waitlist_entries w
      join public.organizations o on o.id = w.org_id
      where w.status = 'waiting'
        and w.email is not null
        and w.freed_at is not null
        and w.day >= (now() at time zone public._org_tz(w.org_id))::date
        and (w.notified_at is null
             or (w.freed_at > w.notified_at and w.notified_at < now() - interval '30 minutes'))
        and not public._org_closed(o.deleted_at, o.plan_expires_at)
      order by w.freed_at
      limit 50
      for update of w skip locked
    ),
    stamped as (
      update public.waitlist_entries w
         set notified_at = now()
        from due
       where w.id = due.id
      returning w.*
    )
    select s.id, s.email, s.customer_name, s.lang, s.day, s.service_ids,
           o.name, o.slug, public._org_tz(s.org_id)
    from stamped s
    join public.organizations o on o.id = s.org_id;
end;
$$;

revoke all on function public.claim_waitlist_notices(text) from public, anon, authenticated;
grant execute on function public.claim_waitlist_notices(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. Names a clinic may never take. The waitlist lives at /waitlist,
--    beside clinic pages at /<slug>; and comparing every dashboard page
--    with this list (2026-10-25) found five more that were never
--    reserved. A clinic called "calendar" would have had its public page
--    hidden behind the dashboard's, since a fixed route wins over /<slug>.
-- ---------------------------------------------------------------------
insert into public.reserved_slugs (slug) values
  ('waitlist'), ('customers'), ('calendar'), ('reports'), ('billing'), ('offers')
on conflict do nothing;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- No clinic may already hold one of the names reserved above (expect 0 rows):
-- select slug from public.organizations where slug in ('waitlist','customers','calendar','reports','billing','offers');
-- select count(*) from pg_trigger where tgname in ('appointments_waitlist_insert','appointments_waitlist_update');  -- 2
-- select has_table_privilege('authenticated', 'public.waitlist_entries', 'select');                                 -- false
-- select public.claim_waitlist_notices('wrong');                                                                     -- not_authorized
