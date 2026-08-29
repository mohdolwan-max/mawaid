-- V2 blueprint, Phase 0: subscription-plan scaffolding (no billing wired
-- yet — see src/lib/plan.ts, populated in a later phase once gated
-- features exist) and a tiebreaker boost for the home page's featured
-- categories in search ordering. The featured-category LIST itself is a
-- pure app-layer constant (FEATURED_CATEGORIES in src/lib/directory.ts,
-- not persisted here) so it stays reversible without a migration.

alter table public.organizations
  add column plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  add column plan_expires_at timestamptz;

-- ---------------------------------------------------------------------
-- list_directory_orgs(): adds an optional featured-category list used
-- two ways by one parameter, per src/lib/directory.ts's
-- FEATURED_CATEGORIES: (1) home page rows pass p_featured_only=true to
-- hard-restrict to that set, (2) /search passes p_featured_only=false
-- (default) so the same list only nudges ordering, never filters. A new
-- parameter changes the function's identity (name + input types) in
-- Postgres, which `create or replace` would leave as a second overload
-- rather than truly replacing — drop the old signature first, same as
-- get_public_org() in 0006_directory.sql, to avoid PostgREST "ambiguous
-- function" errors from two overloads coexisting.
-- ---------------------------------------------------------------------
drop function public.list_directory_orgs(text, text, text, int, int);

create function public.list_directory_orgs(
  p_city text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0,
  p_featured_categories text[] default null,
  p_featured_only boolean default false
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
  review_count int
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.city, o.district, o.category,
         o.logo_url, o.cover_image_url, o.price_tier,
         round(avg(r.rating)::numeric, 1), count(r.id)::int
  from public.organizations o
  left join public.reviews r on r.org_id = o.id
  where o.is_listed
    and o.deleted_at is null
    and (p_city is null or o.city = p_city)
    and (p_category is null or o.category = p_category)
    and (not p_featured_only or p_featured_categories is null or o.category = any(p_featured_categories))
    and (p_search is null or trim(p_search) = ''
         or o.name ilike '%' || trim(p_search) || '%'
         or o.district ilike '%' || trim(p_search) || '%')
  group by o.id
  order by
    case when p_featured_categories is not null and o.category = any(p_featured_categories) then 0 else 1 end,
    avg(r.rating) desc nulls last,
    o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;

revoke all on function public.list_directory_orgs(text, text, text, int, int, text[], boolean) from public;
grant execute on function public.list_directory_orgs(text, text, text, int, int, text[], boolean) to anon, authenticated;
