-- Found live one minute after 0036: the demo laser centre lists a free
-- skin-type consultation (price 0.00) — a legitimate pattern real
-- clinics use — and min(price) dutifully made its card say "from 0 JOD",
-- which reads as broken data, not as a gift.
--
-- "From" means the cheapest PAID service, so zero-priced services leave
-- the aggregate. An org whose only priced services are free shows no
-- price line at all (NULL), same as an org with no prices.
--
-- Signature and return type are unchanged, so CREATE OR REPLACE keeps
-- the existing grants — no DROP, nothing to restate.
-- =====================================================================

create or replace function public.list_directory_orgs(
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
         (select min(sv.price) from public.services sv
           where sv.org_id = o.id and sv.active and sv.price > 0)
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

-- Verify: the laser centre must now say 25 (cheapest paid), not 0.
-- select name, min_price from public.list_directory_orgs(p_limit => 6);
