-- "Nearest clinics" needs two things the schema never had: where each
-- clinic actually IS, and a query that orders by real distance.
--
-- The ranking decision, stated so it can be argued with rather than
-- reverse-engineered: nearest and top-rated are SEPARATE rows, each with
-- one honest ordering — distance is distance, rating is rating. A single
-- blended score (0.7*distance + 0.3*rating and so on) always ends up
-- unexplainable: the clinic that is closest but shown third makes the
-- owner think ranking is rigged, and no weight survives its first
-- counter-example. Two rows, two truths.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Coordinates. Nullable on purpose: a clinic that has not set its
--    location is EXCLUDED from the nearest row, never treated as (0,0)
--    — which is a real place in the Atlantic and would sort a clinic
--    that skipped the field to the bottom of every Jordanian's list
--    while still showing a wrong distance on its card.
--
-- One CHECK for both-or-neither: half a coordinate is not a location,
-- and letting lat land without lng would show clinics at places they
-- are not.
-- ---------------------------------------------------------------------
alter table public.organizations
  add column if not exists lat double precision,
  add column if not exists lng double precision;

-- drop-then-add rather than a pg_constraint name lookup: the lookup
-- matched by NAME ALONE, so a same-named constraint on any table in any
-- schema would have skipped the ADD silently — and a pre-existing
-- different definition on organizations itself would have been kept
-- while the app code trusts exactly this one as its backstop.
-- `drop constraint if exists` is inherently table-scoped.
alter table public.organizations
  drop constraint if exists org_location_valid;

-- Heal any drifted half-coordinates before the ADD, so it cannot fail
-- on existing rows. Half a coordinate was never a location.
update public.organizations
  set lat = null, lng = null
  where (lat is null) <> (lng is null)
     or lat not between -90 and 90
     or lng not between -180 and 180;

alter table public.organizations add constraint org_location_valid check (
  ((lat is null) = (lng is null))
  and (lat is null or (lat between -90 and 90))
  and (lng is null or (lng between -180 and 180))
);


-- ---------------------------------------------------------------------
-- 2. The query. Haversine in plain SQL — no PostGIS: at this scale
--    (hundreds of clinics, not millions) an extension is operational
--    surface for zero gain, and the whole scan measured ~9ms on the
--    directory query that does more work than this one.
--
-- Ordering: distance first, then rating as the tie-break, so two clinics
-- in the same building rank by quality. No radius cut-off — Jordan is
-- 80km end to end and an empty "nearest" row helps nobody; the limit
-- caps the list instead.
--
-- Same review join and same visibility rules as list_directory_orgs
-- (is_listed, not deleted, hidden reviews excluded) so the two rows on
-- the home page can never disagree about who exists or what they rate.
-- ---------------------------------------------------------------------
create function public.list_nearby_orgs(
  p_lat double precision,
  p_lng double precision,
  p_limit int default 12
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
  distance_km numeric
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.city, o.district, o.category,
         o.logo_url, o.cover_image_url, o.price_tier,
         round(avg(r.rating)::numeric, 1), count(r.id)::int,
         -- least(1.0, …): the haversine argument is mathematically ≤ 1,
         -- but floating rounding can nudge it to 1.0000000000000002 for
         -- near-antipodal points — and asin of that is an ERROR, not a
         -- number. The caller's position comes from a client-writable
         -- cookie, so "nobody would ever be at the antipode of Jordan"
         -- is not a guarantee, it is an invitation.
         round((
           6371 * 2 * asin(least(1.0, sqrt(
             power(sin(radians((o.lat - p_lat) / 2)), 2)
             + cos(radians(p_lat)) * cos(radians(o.lat))
               * power(sin(radians((o.lng - p_lng) / 2)), 2)
           )))
         )::numeric, 2)
  from public.organizations o
  left join public.reviews r on r.org_id = o.id and r.hidden_at is null
  where o.is_listed
    and o.deleted_at is null
    and o.lat is not null
    -- a caller with garbage coordinates gets an empty list, not a
    -- distance sort measured from a place that does not exist
    and p_lat between -90 and 90
    and p_lng between -180 and 180
  group by o.id
  order by
    (6371 * 2 * asin(least(1.0, sqrt(
       power(sin(radians((o.lat - p_lat) / 2)), 2)
       + cos(radians(p_lat)) * cos(radians(o.lat))
         * power(sin(radians((o.lng - p_lng) / 2)), 2)
     )))) asc,
    avg(r.rating) desc nulls last,
    o.created_at desc
  limit greatest(1, least(p_limit, 60));
$$;

-- 0028 revoked default execute for new functions, so a new public RPC
-- gets NOTHING unless stated — and this one is meant for anonymous
-- visitors on the marketplace.
revoke all on function public.list_nearby_orgs(double precision, double precision, int) from public;
grant execute on function public.list_nearby_orgs(double precision, double precision, int) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Put the demo clinics on the map, so the feature is visible the
--    moment this runs. Real coordinates for the districts each one
--    claims to be in; guarded by slug so this is a no-op anywhere the
--    seed has not run. The seed file carries the same values for future
--    re-runs.
-- ---------------------------------------------------------------------
update public.organizations set lat = 31.9435, lng = 35.8815 where slug = 'demo-nabd-derma';    -- عبدون
update public.organizations set lat = 31.9986, lng = 35.8481 where slug = 'demo-lamsa-salon';   -- خلدا
update public.organizations set lat = 31.9645, lng = 35.9166 where slug = 'demo-forsan-barber'; -- جبل الحسين
update public.organizations set lat = 31.9663, lng = 35.8987 where slug = 'demo-waha-spa';      -- الشميساني
update public.organizations set lat = 31.9346, lng = 35.8628 where slug = 'demo-luma-laser';    -- الصويفية
update public.organizations set lat = 32.5391, lng = 35.8593 where slug = 'demo-afia-physio';   -- شارع الجامعة، إربد


-- Verify after applying — from عبدون (31.9435, 35.8815) the derma clinic
-- must come back first at 0.00 km and إربد last at ~65 km:
--
--   select slug, distance_km from public.list_nearby_orgs(31.9435, 35.8815, 12);
