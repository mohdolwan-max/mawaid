-- The directory learns which clinics a paid plan features. 0043 put
-- featured = true on the pro plan; this lets the home page ask for exactly
-- those, so the pricing page promise of a featured placement is real.
--
-- Uses the EFFECTIVE plan, so a pro plan past its expiry drops out of the
-- featured row on its own, with no job to run.
--
-- Produced by extracting the function body from 0037 and editing two
-- places (one parameter, one filter) rather than retyping it.
-- A new parameter changes the signature, so DROP + CREATE and the grants
-- restated: 0028 revoked the default privileges that used to cover this.
-- =====================================================================

drop function if exists public.list_directory_orgs(
  text, text, text, int, int, text[], boolean, text, text);
create function public.list_directory_orgs(
  p_city text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0,
  p_featured_categories text[] default null,
  p_featured_only boolean default false,
  p_order text default 'rating',
  p_district text default null,
  -- Pro plan featuring (0043): only orgs whose EFFECTIVE plan is featured.
  -- Sent by the home page featured row, never by search.
  p_plan_featured_only boolean default false
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
    and (not p_plan_featured_only or exists (
      select 1 from public.plans pl
      where pl.id = public.org_effective_plan(o.id) and pl.featured
    ))
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
  text, text, text, int, int, text[], boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.list_directory_orgs(
  text, text, text, int, int, text[], boolean, text, text, boolean) to anon, authenticated;

-- Verify: empty until a clinic is on pro; then that clinic only.
--   select name from public.list_directory_orgs(p_plan_featured_only => true);
--   select public.set_org_plan('moon', 'pro');   -- then re-run the line above
