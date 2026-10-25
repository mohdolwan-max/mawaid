-- Booking links for Google, Instagram and the other places a clinic puts
-- one (owner, 2026-10-25, item 5 of the roadmap: "أزرار الحجز في Google و
-- Instagram").
--
-- Google's own booking button and Instagram's "Book now" action button
-- only accept those companies' partners. What any clinic CAN do is put a
-- link: a Google Business Profile takes appointment links from any
-- business, an Instagram profile takes a website link, and the same holds
-- for Facebook, TikTok and WhatsApp Business. Each place gets its own
-- marked link (/<slug>?src=google, ...), and a booking made from it is
-- marked exactly as the QR code's are (0060): after the booking, by our
-- server only, once, within ten minutes, to a known value.
--
-- The report gains the count per source for the period and the one
-- before. Nothing else in it changes.
-- =====================================================================

alter table public.appointments drop constraint if exists appointments_booking_source;
alter table public.appointments
  add constraint appointments_booking_source check (
    booking_source is null or booking_source in ('qr', 'google', 'instagram', 'facebook', 'tiktok', 'whatsapp'));


-- ---------------------------------------------------------------------
-- 1. set_booking_source (0060) accepts every known source. Same body
--    otherwise; same signature, so the grants carry over (restated).
-- ---------------------------------------------------------------------
create or replace function public.set_booking_source(p_secret text, p_cancel_token uuid, p_source text)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_visit uuid;
  v_count int;
begin
  if not public._booking_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;
  if p_source is null or p_source not in ('qr', 'google', 'instagram', 'facebook', 'tiktok', 'whatsapp') then
    raise exception 'bad_source';
  end if;

  select a.id, a.visit_id into v_id, v_visit
  from public.appointments a
  where a.cancel_token = p_cancel_token
    and a.created_at > now() - interval '10 minutes';
  if v_id is null then
    return 0;
  end if;

  update public.appointments a
     set booking_source = p_source
   where a.booking_source is null
     and a.created_at > now() - interval '10 minutes'
     and (a.id = v_id or (v_visit is not null and a.visit_id = v_visit));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.set_booking_source(text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_booking_source(text, uuid, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. org_report (0064) with the count per source.
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

  -- Where the period's bookings came from (0060, every source since
  -- 0065). Same rows and same window as 'totals', so each share is a
  -- fraction of the very number the page already shows. 'qr' and
  -- 'qr_previous' stay for code deployed before 0065.
  select jsonb_build_object(
           'qr', count(*) filter (where a.booking_source = 'qr'),
           'qr_previous', (
             select count(*) from public.appointments b
             where b.org_id = v_org and b.booking_source = 'qr'
               and b.start_at >= v_prev_start and b.start_at < v_start),
           'by_source', coalesce((
             select jsonb_object_agg(x.booking_source, x.n)
             from (select c.booking_source, count(*) as n
                   from public.appointments c
                   where c.org_id = v_org and c.booking_source is not null
                     and c.start_at >= v_start and c.start_at < v_end
                   group by 1) x), '{}'::jsonb),
           'by_source_previous', coalesce((
             select jsonb_object_agg(x.booking_source, x.n)
             from (select c.booking_source, count(*) as n
                   from public.appointments c
                   where c.org_id = v_org and c.booking_source is not null
                     and c.start_at >= v_prev_start and c.start_at < v_start
                   group by 1) x), '{}'::jsonb))
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
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'appointments_booking_source';  -- lists the six sources
-- select public.set_booking_source('wrong', gen_random_uuid(), 'google');                            -- not_authorized
