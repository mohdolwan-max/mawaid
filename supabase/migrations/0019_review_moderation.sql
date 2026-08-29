-- Review moderation: an org owner can hide (or unhide) a review on
-- their own clinic — there was previously no way at all to act on an
-- abusive or fake review short of contacting support directly. The
-- 0008_reviews.sql RLS policy comment already said "members can view
-- org reviews (dashboard)" — that dashboard page never actually got
-- built until now (src/app/(app)/reviews).

alter table public.reviews add column hidden_at timestamptz;

create function public.hide_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.reviews where id = p_review_id;
  if v_org_id is null then
    raise exception 'review_not_found';
  end if;
  if not public.is_org_owner(v_org_id) then
    raise exception 'not_authorized';
  end if;

  update public.reviews set hidden_at = now() where id = p_review_id;
end;
$$;

revoke all on function public.hide_review(uuid) from public;
grant execute on function public.hide_review(uuid) to authenticated;

create function public.unhide_review(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.reviews where id = p_review_id;
  if v_org_id is null then
    raise exception 'review_not_found';
  end if;
  if not public.is_org_owner(v_org_id) then
    raise exception 'not_authorized';
  end if;

  update public.reviews set hidden_at = null where id = p_review_id;
end;
$$;

revoke all on function public.unhide_review(uuid) from public;
grant execute on function public.unhide_review(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Every public-facing read of reviews/ratings now excludes hidden ones.
-- Same signatures as before → plain create or replace is safe.
-- ---------------------------------------------------------------------
create or replace function public.get_org_reviews(p_org_slug text, p_limit int default 10, p_offset int default 0)
returns table (rating smallint, comment text, customer_name text, created_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select r.rating, r.comment, r.customer_name, r.created_at
  from public.reviews r
  join public.organizations o on o.id = r.org_id
  where o.slug = p_org_slug and o.deleted_at is null and r.hidden_at is null
  order by r.created_at desc
  limit greatest(1, least(p_limit, 50))
  offset greatest(0, p_offset);
$$;

create or replace function public.get_org_rating_summary(p_org_slug text)
returns table (avg_rating numeric, review_count int)
language sql
security definer
stable
set search_path = public
as $$
  select round(avg(r.rating)::numeric, 1), count(*)::int
  from public.reviews r
  join public.organizations o on o.id = r.org_id
  where o.slug = p_org_slug and o.deleted_at is null and r.hidden_at is null;
$$;

-- Filter belongs in the JOIN condition, not WHERE — this is a LEFT
-- JOIN, so an org whose only reviews are hidden must still show up
-- with review_count=0/avg_rating=null, not disappear from the listing
-- entirely (WHERE would drop that whole grouped row).
create or replace function public.list_directory_orgs(
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
    case when p_featured_categories is not null and o.category = any(p_featured_categories) then 0 else 1 end,
    avg(r.rating) desc nulls last,
    o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;
