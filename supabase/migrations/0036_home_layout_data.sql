-- Data for the Wddk-inspired home layout (owner's UI playbook, 2026-09):
-- richer cards, browse-by-district tiles, and an "open now" count.
-- Three rules carried through every piece:
--   * every number shown is COMPUTED, never decorative — the playbook's
--     mock figures ("40+ bookings") are exactly what we refuse to ship;
--   * only listed, non-deleted orgs are ever counted or returned;
--   * the app calls each new thing optionally, so this migration and the
--     deploy can land in either order.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. list_directory_orgs learns `min_price` ("from 25 JOD" on cards)
--    and a district filter (the zone tiles link into search by district).
--
-- Return type AND signature change -> DROP + CREATE + grants restated
-- (0028 revoked the default privileges that would otherwise paper over
-- forgetting them). The app sends p_district/p_order only when set, so
-- a deploy against the previous 8-arg function keeps working.
-- ---------------------------------------------------------------------
drop function if exists public.list_directory_orgs(
  text, text, text, int, int, text[], boolean, text);

create function public.list_directory_orgs(
  p_city text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0,
  p_featured_categories text[] default null,
  p_featured_only boolean default false,
  p_order text default 'rating',
  p_district text default null
)
returns table (
  org_id uuid,
  name text,
  slug text,
  city text,
  district text,
  category text,
  logo_url text,
  cover_image_url text,
  price_tier smallint,
  avg_rating numeric,
  review_count int,
  min_price numeric
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.city, o.district, o.category,
         o.logo_url, o.cover_image_url, o.price_tier,
         round(avg(r.rating)::numeric, 1), count(r.id)::int,
         -- Cheapest ACTIVE service, priced. An org with no priced
         -- services gets NULL and the card simply shows no "from" line —
         -- never 0, which would read as free.
         (select min(sv.price) from public.services sv
           where sv.org_id = o.id and sv.active and sv.price is not null)
  from public.organizations o
  left join public.reviews r on r.org_id = o.id and r.hidden_at is null
  where o.is_listed
    and o.deleted_at is null
    and (p_city is null or o.city = p_city)
    and (p_district is null or o.district = p_district)
    and (p_category is null or o.category = p_category)
    and (not p_featured_only or p_featured_categories is null or o.category = any(p_featured_categories))
    and (p_search is null or trim(p_search) = ''
         or o.name ilike '%' || trim(p_search) || '%'
         or o.district ilike '%' || trim(p_search) || '%')
  group by o.id
  order by
    case when p_order = 'newest' then o.created_at end desc nulls last,
    case when p_order <> 'newest' and p_featured_categories is not null
              and o.category = any(p_featured_categories) then 0 else 1 end,
    case when p_order <> 'newest' then avg(r.rating) end desc nulls last,
    o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;

revoke all on function public.list_directory_orgs(
  text, text, text, int, int, text[], boolean, text, text) from public, anon, authenticated;
grant execute on function public.list_directory_orgs(
  text, text, text, int, int, text[], boolean, text, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. District tiles: real counts, only districts that actually have a
--    listed org. district is owner-typed free text, so the grouping is
--    by whatever strings exist — a misspelled district shows up as its
--    own tile, which is honest and self-correcting (the owner sees it).
-- ---------------------------------------------------------------------
drop function if exists public.list_district_counts(text);

create function public.list_district_counts(p_city text default null)
returns table (district text, org_count int)
language sql
security definer
stable
set search_path = public
as $$
  select o.district, count(*)::int
  from public.organizations o
  where o.is_listed
    and o.deleted_at is null
    and o.district is not null
    and trim(o.district) <> ''
    and (p_city is null or o.city = p_city)
  group by o.district
  order by count(*) desc, o.district
  limit 12;
$$;

revoke all on function public.list_district_counts(text) from public, anon, authenticated;
grant execute on function public.list_district_counts(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. "N clinics open right now" — the context-header line that replaces
--    the playbook's weather idea with something a patient actually uses.
--
-- Each org is evaluated in ITS OWN timezone against its own
-- business_hours jsonb (keys "0"-"6", 0 = Sunday — same convention as
-- extract(dow) and the slot engine in 0013). Malformed or missing hours
-- count as closed, via coalesce + the null-propagating casts.
-- ---------------------------------------------------------------------
drop function if exists public.count_open_now(text);

create function public.count_open_now(p_city text default null)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int
  from public.organizations o
  join public.org_settings s on s.org_id = o.id
  where o.is_listed
    and o.deleted_at is null
    and (p_city is null or o.city = p_city)
    and coalesce((
      select not coalesce((d.value ->> 'closed')::boolean, true)
         and (now() at time zone s.timezone)::time >= (d.value ->> 'open')::time
         and (now() at time zone s.timezone)::time <  (d.value ->> 'close')::time
      from jsonb_each(s.business_hours) d
      where d.key = extract(dow from now() at time zone s.timezone)::int::text
    ), false);
$$;

revoke all on function public.count_open_now(text) from public, anon, authenticated;
grant execute on function public.count_open_now(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select name, min_price from public.list_directory_orgs(p_limit => 5);
-- select * from public.list_district_counts('amman');
-- select public.count_open_now('amman');
