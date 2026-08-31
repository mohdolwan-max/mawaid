-- Fixes for 0024, found by adversarial review AFTER 0024 was applied —
-- hence a new migration rather than an edit to it.
--
-- 0024 shipped a 15-day fuse that could not actually fire for a clinic
-- owner, and an "undo" the owner could never reach. Both were verified
-- against the live schema before writing this.

-- ---------------------------------------------------------------------
-- 1. BLOCKER: purging an OWNER always aborted.
--
--    memberships.user_id is ON DELETE CASCADE (0001:53), but
--    appointments.staff_id references memberships(id) with no ON DELETE
--    rule (0004:14), i.e. NO ACTION. So `delete from auth.users`
--    cascade-deleted the membership, which then violated
--    appointments_staff_id_fkey and aborted the whole statement.
--
--    Since 0013 every booking carries a real membership id as staff_id
--    (the any-staff loop inserts v_candidate.membership_id), so for a
--    solo clinic the owner's own membership is staff_id on every
--    appointment the clinic ever took. This was the default path, not an
--    edge case: no owner of a clinic that had taken a single booking
--    could ever be purged.
--
--    The fix is to detach rather than cascade. 0022 made user_id nullable
--    exactly to express "a real bookable person with no login", which is
--    precisely what a purged owner's row should become: the clinic keeps
--    its schedule and its history of who saw whom, the login goes away.
--
--    NOT chosen: ON DELETE SET NULL on appointments.staff_id. resource_id
--    is `generated always as (coalesce(staff_id, org_id)) stored` and
--    feeds the no_overlap GiST exclusion, so nulling staff_id would
--    collapse separate staff onto one resource and trade the FK abort for
--    an exclusion-violation abort — while also destroying the record of
--    which staff member saw which patient.
--
--    Safe because: user_id is already nullable (0022); unique
--    (org_id, user_id) tolerates many NULLs since NULLs are distinct;
--    is_org_member/is_org_owner compare user_id = auth.uid(), which never
--    matches NULL, so a detached row grants nobody any access.
-- ---------------------------------------------------------------------
alter table public.memberships
  drop constraint memberships_user_id_fkey;

alter table public.memberships
  add constraint memberships_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. BLOCKER: the purge was a single all-or-nothing statement.
--
--    One unpurgeable row aborted the entire batch, the cron route
--    returned 500, the offending account_deletions row stayed due, and
--    the identical failure repeated every night while the queue grew —
--    so one bad account silently blocked deletion for everybody.
--
--    Now: one subtransaction per account, so a failure is isolated,
--    logged, and retried next run without holding up the rest.
--
--    Also hardens the secret check. `p_secret is distinct from (select
--    ...)` passes when BOTH sides are NULL, so if the app_config row
--    were ever missing, a call with p_secret=null would be treated as
--    authorised. Verified not exploitable today (the row exists — a null
--    secret is correctly rejected), but the guard should not depend on
--    that. NOTE: claim_due_reminders and delete_push_subscription (0009)
--    share this exact pattern and are worth the same treatment.
--
--    Signature and return type are unchanged, so create or replace is
--    correct here and the cron route keeps working untouched.
-- ---------------------------------------------------------------------
create or replace function public.purge_due_accounts(p_secret text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_count int := 0;
  r record;
begin
  select value into v_secret from public.app_config where key = 'cron_secret';

  -- Explicit null checks: never let a missing config row become an open door.
  if v_secret is null or p_secret is null or p_secret is distinct from v_secret then
    raise exception 'not_authorized';
  end if;

  for r in
    select user_id from public.account_deletions
    where purge_after <= now()
    order by purge_after
  loop
    begin
      -- Detach the login from the person BEFORE deleting the user. The
      -- FK above would do this anyway, but doing it explicitly also lets
      -- us keep the row identifiable: create_organization inserts the
      -- owner membership with no display_name (0001), so a purged owner
      -- would otherwise be left both loginless AND nameless, and
      -- list_public_staff_for_service (0022) hides unnamed staff.
      -- u.email::text because auth.users.email is varchar — the exact
      -- type mismatch that broke list_org_staff in 0015.
      update public.memberships m
      set user_id = null,
          display_name = coalesce(
            nullif(trim(coalesce(m.display_name, '')), ''),
            split_part((select u.email::text from auth.users u where u.id = m.user_id), '@', 1)
          )
      where m.user_id = r.user_id;

      delete from auth.users where id = r.user_id;
      v_count := v_count + 1;
    exception
      when others then
        -- Per-account subtransaction: one bad row cannot abort the batch.
        raise warning 'purge failed for %: %', r.user_id, sqlerrm;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.purge_due_accounts(text) from public;
grant execute on function public.purge_due_accounts(text) to anon, authenticated;
