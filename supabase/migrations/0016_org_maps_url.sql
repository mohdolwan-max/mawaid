-- Google Maps / location link per organization, shown as a "Get
-- directions" button on the public clinic page. A plain URL the owner
-- pastes from their existing Google Maps listing (share link) is far
-- less friction for a non-technical owner than asking for lat/lng, and
-- needs no geocoding on our side.

alter table public.organizations add column maps_url text;

-- get_public_org(): widened with maps_url. Return-type change requires
-- drop + create (create or replace can't alter it) — same reasoning as
-- the 0006_directory.sql widening this is layered on top of.
drop function public.get_public_org(text);

create function public.get_public_org(p_slug text)
returns table (
  org_id uuid,
  name text,
  slug text,
  address text,
  phone text,
  logo_url text,
  timezone text,
  category text,
  city text,
  district text,
  description text,
  cover_image_url text,
  price_tier smallint,
  maps_url text
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.address, o.phone, o.logo_url, s.timezone,
         o.category, o.city, o.district, o.description, o.cover_image_url, o.price_tier,
         o.maps_url
  from public.organizations o
  join public.org_settings s on s.org_id = o.id
  where o.slug = p_slug and o.deleted_at is null;
$$;

revoke all on function public.get_public_org(text) from public;
grant execute on function public.get_public_org(text) to anon, authenticated;
