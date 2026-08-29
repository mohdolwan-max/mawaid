-- Self-service org closure. organizations.deleted_at already exists
-- and every public read (get_public_org, list_directory_orgs,
-- book_appointment, ...) already excludes it — the only missing piece
-- was a way for the owner to actually set it themselves; previously
-- the privacy policy's "contact us to delete your account" was the
-- only route, which is fine at low volume but doesn't scale.
--
-- Soft delete only, same as everywhere else in this schema: existing
-- appointments/reviews/customers are untouched, the org just stops
-- appearing anywhere and can't take new bookings. Reopening requires
-- an admin clearing deleted_at directly for now — no self-service
-- "undo", matching how most "delete my account" flows work.
create function public.close_organization()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
  from public.memberships
  where user_id = auth.uid() and role = 'owner'
  limit 1;

  if v_org_id is null then
    raise exception 'not_authorized';
  end if;

  update public.organizations set deleted_at = now() where id = v_org_id;
end;
$$;

revoke all on function public.close_organization() from public;
grant execute on function public.close_organization() to authenticated;
