-- Reports for the clinic owner.
--
-- A UX review of the owner dashboard (2026-09-20) put it plainly: two
-- counters on the home page are the whole reporting story, and reports are
-- what makes an owner renew a 19-39 JOD subscription. This is the data
-- side: one call, one period, the numbers an owner actually asks for.
--
-- Decided here, and why:
--   * A day is the day of the VISIT (start_at), not the day the booking
--     was made. "How did last month go" is a question about the diary.
--   * Money is the price of the services on completed visits, and the
--     count of completed visits with NO price travels beside it. A clinic
--     that prices nothing must see "0 priced of 14", never a confident 0
--     (ENGINEERING-STANDARDS section 1).
--   * Staff rows carry the membership id only. The page already loads the
--     staff list for its own labels, and one source for a name is better
--     than two that can disagree.
--   * Owner only: _my_owner_org() decides, not a parameter, so no caller
--     can ask about another clinic. Staff see the dashboard, not revenue.
-- =====================================================================

drop function if exists public.org_report(date, date);
create function public.org_report(p_from date, p_to date)
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
  -- money, and a cancelled one never was.
  select jsonb_build_object(
           'completed_value', coalesce(sum(sv.price), 0),
           'priced',          count(*) filter (where sv.price is not null),
           'unpriced',        count(*) filter (where sv.price is null),
           'previous_value',  (
             select coalesce(sum(sv2.price), 0)
             from public.appointments a2
             join public.services sv2 on sv2.id = a2.service_id
             where a2.org_id = v_org and a2.status = 'completed'
               and a2.start_at >= v_prev_start and a2.start_at < v_start
           ))
    into v_money
  from public.appointments a
  join public.services sv on sv.id = a.service_id
  where a.org_id = v_org and a.status = 'completed'
    and a.start_at >= v_start and a.start_at < v_end;

  select coalesce(jsonb_agg(x order by x.total desc, x.name), '[]'::jsonb)
    into v_services
  from (
    select sv.id as service_id, sv.name,
           count(*) as total,
           count(*) filter (where a.status = 'completed') as completed,
           count(*) filter (where a.status = 'no_show') as no_show,
           coalesce(sum(sv.price) filter (where a.status = 'completed'), 0) as value
    from public.appointments a
    join public.services sv on sv.id = a.service_id
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
           coalesce(sum(sv.price) filter (where a.status = 'completed'), 0) as value
    from public.appointments a
    left join public.services sv on sv.id = a.service_id
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
           coalesce(sum(sv.price) filter (where a.status = 'completed'), 0) as value
    from public.appointments a
    left join public.services sv on sv.id = a.service_id
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
    'series', v_series);
end;
$$;

revoke all on function public.org_report(date, date) from public, anon, authenticated;
grant execute on function public.org_report(date, date) to authenticated;


-- ---------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------
-- As a signed-in clinic owner (the SQL editor runs as postgres, where
-- auth.uid() is null, so this raises not_authorized there — that IS the
-- check working):
--   select public.org_report(current_date - 29, current_date);
select has_function_privilege('authenticated', 'public.org_report(date,date)', 'execute') as owner_may_call,
       has_function_privilege('anon', 'public.org_report(date,date)', 'execute') as anon_may_call;
