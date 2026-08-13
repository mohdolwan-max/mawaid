-- Directory / marketplace foundation: public-profile columns on
-- organizations, the anon directory-browsing RPC, and the org-media
-- storage bucket. Orgs are UNLISTED by default (is_listed=false) — the
-- owner opts into the public directory from Settings.

alter table public.organizations
  add column category text,
  add column city text,
  add column district text,
  add column description text,
  add column cover_image_url text,
  add column price_tier smallint check (price_tier between 1 and 3),
  add column is_listed boolean not null default false;

create index organizations_directory_idx
  on public.organizations (city, category)
  where is_listed and deleted_at is null;

-- New app routes that must never be claimable as org slugs.
insert into public.reserved_slugs (slug) values
  ('search'), ('my'), ('account'), ('explore'), ('partners'), ('customer'),
  ('c'), ('reviews'), ('help'), ('about'), ('contact'), ('terms'),
  ('privacy'), ('app')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- get_public_org(): widened with the directory columns. Return-type
-- changes require drop + create (create or replace can't alter it).
-- ---------------------------------------------------------------------
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
  price_tier smallint
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.address, o.phone, o.logo_url, s.timezone,
         o.category, o.city, o.district, o.description, o.cover_image_url, o.price_tier
  from public.organizations o
  join public.org_settings s on s.org_id = o.id
  where o.slug = p_slug and o.deleted_at is null;
$$;

revoke all on function public.get_public_org(text) from public;
grant execute on function public.get_public_org(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- list_directory_orgs(): the marketplace browse/search RPC. avg_rating/
-- review_count are in the signature NOW (returning null/0) so the
-- reviews migration can later swap in real aggregates with a plain
-- `create or replace` — no signature change, no drop.
-- ---------------------------------------------------------------------
create function public.list_directory_orgs(
  p_city text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0
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
         null::numeric, 0
  from public.organizations o
  where o.is_listed
    and o.deleted_at is null
    and (p_city is null or o.city = p_city)
    and (p_category is null or o.category = p_category)
    and (p_search is null or trim(p_search) = ''
         or o.name ilike '%' || trim(p_search) || '%'
         or o.district ilike '%' || trim(p_search) || '%')
  order by o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;

revoke all on function public.list_directory_orgs(text, text, text, int, int) from public;
grant execute on function public.list_directory_orgs(text, text, text, int, int) to anon, authenticated;

-- ---------------------------------------------------------------------
-- org-media storage bucket: public read, owner-only writes under a
-- top-level folder named by the org id ({orgId}/cover-....jpg).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('org-media', 'org-media', true)
on conflict (id) do nothing;

create policy "public can view org media"
  on storage.objects for select
  using (bucket_id = 'org-media');

create policy "org owner can upload org media"
  on storage.objects for insert
  with check (
    bucket_id = 'org-media'
    and public.is_org_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "org owner can update org media"
  on storage.objects for update
  using (
    bucket_id = 'org-media'
    and public.is_org_owner(((storage.foldername(name))[1])::uuid)
  );

create policy "org owner can delete org media"
  on storage.objects for delete
  using (
    bucket_id = 'org-media'
    and public.is_org_owner(((storage.foldername(name))[1])::uuid)
  );
