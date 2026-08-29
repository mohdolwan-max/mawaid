-- Second list_org_staff bug, surfaced only after 0014 fixed the ORDER BY
-- error and the function could actually run its type-check: "Returned
-- type character varying does not match expected type text in column 3."
-- auth.users.email is `character varying`, not `text`; a bare UNION ALL
-- resolves the combined column type from the first branch (varchar),
-- which then fails the function's strict `RETURNS TABLE(... email
-- text ...)` check. This looks to have been broken since the function was
-- first created in 0003_staff.sql — confirmed live via a direct RPC call
-- before writing this fix, not assumed. Cast to text explicitly.

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
    select m.id, m.user_id, u.email::text, m.role, false, m.display_name, m.bio, m.photo_url, m.business_hours
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
  union all
    select null::uuid, null::uuid, i.email::text, i.role, true, null::text, null::text, null::text, null::jsonb
    from public.invitations i
    where i.org_id = p_org_id and i.accepted_at is null
  order by 5, 3; -- 5 = pending, 3 = email
end;
$$;
