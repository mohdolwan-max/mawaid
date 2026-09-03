-- The home page can only rank by rating, so a clinic with no reviews is
-- invisible everywhere except its category chip and search — exactly the
-- clinics that just signed up and need the exposure most. (Found by the
-- owner himself, opening a brand-new account and not finding it.)
--
-- This teaches list_directory_orgs a second ordering, 'newest', so the
-- home page can add a general "all clinics" row where fresh signups lead
-- instead of trailing a rating they cannot have yet. The old two-rows-
-- one-ordering trap (both rows rendering the same list under different
-- headings) was why that row was removed; now the orderings genuinely
-- differ.
--
-- Adding a parameter CHANGES THE SIGNATURE: create-or-replace would
-- leave the old 7-arg function standing beside the new 8-arg one, and
-- PostgREST refuses ambiguous overloads. So: DROP, CREATE, and restate
-- the grants — which 0028's default-privilege revoke makes mandatory,
-- not just good manners.
-- =====================================================================

drop function if exists public.list_directory_orgs(
  text, text, text, int, int, text[], boolean);

create function public.list_directory_orgs(
  p_city text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0,
  p_featured_categories text[] default null,
  p_featured_only boolean default false,
  p_order text default 'rating'
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
  left join public.reviews r on r.org_id = o.id and r.hidden_at is null
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
    -- 'newest': pure signup recency. Any value other than 'newest'
    -- (including garbage) falls through to the rating ordering below —
    -- an unknown sort must degrade to the default, never to an error a
    -- visitor sees.
    case when p_order = 'newest' then o.created_at end desc nulls last,
    case when p_order <> 'newest' and p_featured_categories is not null
              and o.category = any(p_featured_categories) then 0 else 1 end,
    case when p_order <> 'newest' then avg(r.rating) end desc nulls last,
    o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;

-- DROP discarded the old grants, and 0028 revoked the default privileges
-- that used to paper over forgetting this line.
revoke all on function public.list_directory_orgs(
  text, text, text, int, int, text[], boolean, text) from public, anon, authenticated;
grant execute on function public.list_directory_orgs(
  text, text, text, int, int, text[], boolean, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Verify: both orderings answer, and differently.
-- ---------------------------------------------------------------------
-- select name from public.list_directory_orgs(p_order => 'rating', p_limit => 5);
-- select name from public.list_directory_orgs(p_order => 'newest', p_limit => 5);
