-- Search by free time (owner, 2026-10-25, item 9 of the roadmap: "البحث حسب
-- الوقت المتاح"). "Who can do laser today after five?" answered from the
-- clinics' real diaries.
--
-- Decided here, and why:
--   * The pool is exactly the directory's (listed, open, in the visitor's
--     country, city and category); nothing a visitor could not already
--     find is shown.
--   * The words typed match a clinic's name OR a service's name: "ليزر"
--     finds laser services in any clinic, which the name-only directory
--     search could not.
--   * Times come from get_available_slots itself, the same answer the
--     booking page gives, so a time shown here is a time that can be
--     booked (until someone else books it). Up to two services per
--     clinic (those matching the words first) and the first six times in
--     the window each, earliest first across clinics.
--   * Bounded so one search cannot become a heavy query: today and the
--     next 13 days only, at most 40 clinics examined, at most 20 rows.
-- =====================================================================

create or replace function public._open_times_rows(
  p_country text,
  p_city text,
  p_category text,
  p_query text,
  p_date date,
  p_from time,
  p_to time
)
returns table (
  org_id uuid,
  org_name text,
  org_slug text,
  city text,
  district text,
  logo_url text,
  avg_rating numeric,
  review_count int,
  currency text,
  service_id uuid,
  service_name text,
  price numeric,
  duration_minutes int,
  times timestamptz[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  o record;
  s record;
  v_tz text;
  v_times timestamptz[];
begin
  for o in
    select d.org_id as id, d.name, d.slug, d.city, d.district, d.logo_url, d.avg_rating, d.review_count, d.currency
    from public.list_directory_orgs(p_city, p_category, null, 60, 0, null, false, 'rating', null, false, p_country) d
    where v_q is null
       or d.name ilike '%' || v_q || '%'
       or exists (select 1 from public.services sv
                  where sv.org_id = d.org_id and sv.active and sv.name ilike '%' || v_q || '%')
    limit 40
  loop
    v_tz := public._org_tz(o.id);
    for s in
      select sv.id, sv.name, sv.price, sv.duration_minutes
      from public.services sv
      where sv.org_id = o.id and sv.active
        and (v_q is null or o.name ilike '%' || v_q || '%' or sv.name ilike '%' || v_q || '%')
      order by (v_q is not null and sv.name ilike '%' || v_q || '%') desc, sv.sort_order, sv.created_at
      limit 2
    loop
      select array_agg(x.start_at order by x.start_at)
        into v_times
      from (
        select g.start_at
        from public.get_available_slots(o.slug, s.id, p_date, null) g
        where (g.start_at at time zone v_tz)::time >= coalesce(p_from, time '00:00')
          and (g.start_at at time zone v_tz)::time < coalesce(p_to, time '24:00')
        order by g.start_at
        limit 6
      ) x;
      if v_times is not null then
        org_id := o.id; org_name := o.name; org_slug := o.slug; city := o.city; district := o.district;
        logo_url := o.logo_url; avg_rating := o.avg_rating; review_count := o.review_count; currency := o.currency;
        service_id := s.id; service_name := s.name; price := s.price; duration_minutes := s.duration_minutes;
        times := v_times;
        return next;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public._open_times_rows(text, text, text, text, date, time, time) from public, anon, authenticated;

drop function if exists public.search_open_times(text, text, text, text, date, time, time);
create function public.search_open_times(
  p_country text,
  p_city text,
  p_category text,
  p_query text,
  p_date date,
  p_from time,
  p_to time
)
returns table (
  org_id uuid,
  org_name text,
  org_slug text,
  city text,
  district text,
  logo_url text,
  avg_rating numeric,
  review_count int,
  currency text,
  service_id uuid,
  service_name text,
  price numeric,
  duration_minutes int,
  times timestamptz[]
)
language sql
stable
security definer
set search_path = public
as $$
  select r.*
  from public._open_times_rows(p_country, p_city, p_category, left(p_query, 60), p_date, p_from, p_to) r
  where p_date is not null
    -- "Today" is the visitor's country's today at the latest; a day or so
    -- of slack either side costs nothing, the slots decide.
    and p_date between current_date - 1 and current_date + 13
  order by r.times[1], r.org_name
  limit 20;
$$;

revoke all on function public.search_open_times(text, text, text, text, date, time, time) from public, anon, authenticated;
grant execute on function public.search_open_times(text, text, text, text, date, time, time) to anon, authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select org_slug, service_name, times[1] from public.search_open_times('JO', null, null, null, current_date + 1, '09:00', '13:00');
