-- A center offering several services (e.g. dental + whitening + braces)
-- previously had no visual way to distinguish them on its public page —
-- just a plain text list. Each service can now carry its own photo.

alter table public.services add column photo_url text;

-- list_public_services(): widened with photo_url. Return-type change
-- requires drop + create, same reasoning as every other widened RPC
-- in this schema (get_public_org in 0006_directory.sql, etc.).
drop function public.list_public_services(text);

create function public.list_public_services(p_org_slug text)
returns table (id uuid, name text, duration_minutes int, price numeric, photo_url text)
language sql
security definer
stable
set search_path = public
as $$
  select sv.id, sv.name, sv.duration_minutes, sv.price, sv.photo_url
  from public.services sv
  join public.organizations o on o.id = sv.org_id
  where o.slug = p_org_slug and o.deleted_at is null and sv.active
  order by sv.sort_order, sv.created_at;
$$;

revoke all on function public.list_public_services(text) from public;
grant execute on function public.list_public_services(text) to anon, authenticated;
