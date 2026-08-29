-- Hotfix: list_org_staff() as shipped in 0013 fails on every call with
-- "invalid UNION/INTERSECT/EXCEPT ORDER BY clause — only result column
-- names can be used, not expressions or functions" (postgres 0A000).
-- `order by pending, email` referenced "pending", but the boolean
-- literals `false`/`true` in the SELECT lists are unaliased expressions,
-- not named columns — Postgres has no "pending" name to resolve there
-- regardless of the function's RETURNS TABLE column names (those only
-- shape the final output tuple, they don't name the inner query's own
-- columns for its own ORDER BY). Fix: order by ordinal position instead,
-- which is unambiguous. Same signature/return type as 0013 — plain
-- create or replace is safe (no drop needed since the function IS being
-- fully redefined, not extended).

create or replace function public.list_org_staff(p_org_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  role text,
  pending boolean,
  display_name text,
  bio text,
  photo_url text,
  business_hours jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not_authorized';
  end if;

  return query
    select m.id, m.user_id, u.email, m.role, false, m.display_name, m.bio, m.photo_url, m.business_hours
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
  union all
    select null::uuid, null::uuid, i.email, i.role, true, null::text, null::text, null::text, null::jsonb
    from public.invitations i
    where i.org_id = p_org_id and i.accepted_at is null
  order by 5, 3; -- 5 = pending, 3 = email
end;
$$;
