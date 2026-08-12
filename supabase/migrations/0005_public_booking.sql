-- Public read access for the booking storefront (/[orgSlug]/*), anonymous.
--
-- organizations/services keep their existing member-only RLS policies —
-- rather than adding a second, broader "public can select" policy on those
-- tables (which would let anyone dump every tenant's full row with a plain
-- select), public access goes through narrow security-definer RPCs, same
-- principle as the appointments RPCs in 0004: return only the specific
-- columns/rows a stranger on a clinic's booking page actually needs.

create function public.get_public_org(p_slug text)
returns table (org_id uuid, name text, slug text, address text, phone text, logo_url text, timezone text)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.address, o.phone, o.logo_url, s.timezone
  from public.organizations o
  join public.org_settings s on s.org_id = o.id
  where o.slug = p_slug and o.deleted_at is null;
$$;

revoke all on function public.get_public_org(text) from public;
grant execute on function public.get_public_org(text) to anon, authenticated;

create function public.list_public_services(p_org_slug text)
returns table (id uuid, name text, duration_minutes int, price numeric)
language sql
security definer
stable
set search_path = public
as $$
  select sv.id, sv.name, sv.duration_minutes, sv.price
  from public.services sv
  join public.organizations o on o.id = sv.org_id
  where o.slug = p_org_slug and o.deleted_at is null and sv.active
  order by sv.sort_order, sv.created_at;
$$;

revoke all on function public.list_public_services(text) from public;
grant execute on function public.list_public_services(text) to anon, authenticated;

-- Staff selectable for a given service on the public booking page. Empty
-- staff_services rows for a service means any staff performs it, so in
-- that case this returns every staff member in the org.
create function public.list_public_staff_for_service(p_org_slug text, p_service_id uuid)
returns table (membership_id uuid, email text)
language sql
security definer
stable
set search_path = public
as $$
  select m.id, u.email
  from public.memberships m
  join auth.users u on u.id = m.user_id
  join public.organizations o on o.id = m.org_id
  where o.slug = p_org_slug and o.deleted_at is null
    and (
      not exists (select 1 from public.staff_services ss where ss.service_id = p_service_id)
      or exists (
        select 1 from public.staff_services ss
        where ss.service_id = p_service_id and ss.staff_membership_id = m.id
      )
    )
  order by u.email;
$$;

revoke all on function public.list_public_staff_for_service(text, uuid) from public;
grant execute on function public.list_public_staff_for_service(text, uuid) to anon, authenticated;
