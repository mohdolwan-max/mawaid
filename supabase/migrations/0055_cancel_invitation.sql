-- A pending invitation holds a seat, and nothing could take it back.
--
-- A UX review (2026-09-20) reported a clinic reading "Staff: 4 of 5" with
-- one staff member on screen. The counter is right — _org_seats_used(0043)
-- counts memberships PLUS unaccepted invitations, because an invitation is
-- a seat already promised — but an owner had no way to see which invites
-- were outstanding as seats, and no way to withdraw one. A mistyped email
-- took a seat until the plan was upgraded.
--
-- Two changes: list_org_staff hands back the invitation id for its pending
-- rows (it already returned them, but anonymously), and cancel_invitation
-- withdraws one.
-- =====================================================================

drop function if exists public.list_org_staff(uuid);
create function public.list_org_staff(p_org_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  email text,
  phone text,
  title text,
  role text,
  pending boolean,
  display_name text,
  bio text,
  photo_url text,
  business_hours jsonb,
  invitation_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not_authorized';
  end if;

  return query
    select m.id, m.user_id, u.email::text, m.phone, m.title, m.role, false,
           m.display_name, m.bio, m.photo_url, m.business_hours, null::uuid
    from public.memberships m
    left join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
  union all
    select null::uuid, null::uuid, i.email::text, null::text, null::text, i.role, true,
           null::text, null::text, null::text, null::jsonb, i.id
    from public.invitations i
    where i.org_id = p_org_id and i.accepted_at is null
  order by 7, 8 nulls last, 3; -- pending, then display_name, then email
end;
$$;

revoke all on function public.list_org_staff(uuid) from public, anon, authenticated;
grant execute on function public.list_org_staff(uuid) to authenticated;

-- Withdraws an invitation that has not been accepted, freeing its seat.
-- Owner only, and only inside their own clinic: the id alone decides
-- nothing until the org behind it is checked.
drop function if exists public.cancel_invitation(uuid);
create function public.cancel_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_accepted timestamptz;
begin
  select i.org_id, i.accepted_at into v_org, v_accepted
  from public.invitations i
  where i.id = p_invitation_id;

  if v_org is null then
    raise exception 'invitation_not_found';
  end if;
  if not public.is_org_owner(v_org) then
    raise exception 'not_authorized';
  end if;
  -- An accepted invitation is history, and its seat is a membership now;
  -- deleting it would say the person was never invited.
  if v_accepted is not null then
    raise exception 'invitation_already_accepted';
  end if;

  delete from public.invitations where id = p_invitation_id;
  return true;
end;
$$;

revoke all on function public.cancel_invitation(uuid) from public, anon, authenticated;
grant execute on function public.cancel_invitation(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------
-- A member may read the list; only an owner may withdraw an invite, and
-- the function checks that itself:
select has_function_privilege('authenticated', 'public.list_org_staff(uuid)', 'execute') as member_may_list,
       has_function_privilege('authenticated', 'public.cancel_invitation(uuid)', 'execute') as owner_may_cancel,
       has_function_privilege('anon', 'public.cancel_invitation(uuid)', 'execute') as anon_may_cancel;
