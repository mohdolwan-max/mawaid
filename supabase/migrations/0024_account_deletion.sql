-- Permanent account deletion, for customers and for clinic owners, with
-- a 15-day grace period — plus the clinic-facing notification inbox the
-- cancellations feed into.
--
-- Shape of the flow:
--   1. The user asks to delete. Immediately: every FUTURE booking of
--      theirs is cancelled, and each affected clinic gets a notification
--      right away — not after the grace period. A clinic that finds out
--      15 days later has already sat waiting for a patient who was never
--      coming, and the appointment is long past.
--   2. For 15 days nothing is destroyed and the user can undo.
--   3. After 15 days a cron purge deletes the auth user for real.
--
-- What survives the purge, by explicit product decision: the clinic
-- keeps its own booking records. appointments.customer_name /
-- customer_phone are plain columns on the appointment, so the clinic's
-- history, revenue and no-show stats stay intact; only the LINK to the
-- (now deleted) account goes away. Note this means deletion is not
-- absolute erasure everywhere — the privacy policy is updated to say so
-- rather than promising something the system does not do.

-- ---------------------------------------------------------------------
-- Without this the purge simply fails: appointments.customer_user_id was
-- declared `references auth.users(id)` with NO on-delete rule (0004:25),
-- which defaults to NO ACTION, so deleting a user who has ever booked
-- raises a foreign-key violation and aborts. SET NULL is also exactly
-- the semantics we want: unlink the account, keep the booking.
-- ---------------------------------------------------------------------
alter table public.appointments
  drop constraint appointments_customer_user_id_fkey;

alter table public.appointments
  add constraint appointments_customer_user_id_fkey
  foreign key (customer_user_id) references auth.users(id) on delete set null;

-- ---------------------------------------------------------------------
-- Clinic-facing notification inbox. Nothing like this existed: the only
-- notification machinery was outbound Web Push to CUSTOMERS (0009).
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('booking_cancelled')),
  title text not null,
  body text,
  -- SET NULL, not CASCADE: the notification is the record that something
  -- was cancelled, and must outlive the row it refers to.
  appointment_id uuid references public.appointments(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_org_created_idx
  on public.notifications (org_id, created_at desc);
create index notifications_org_unread_idx
  on public.notifications (org_id) where read_at is null;

alter table public.notifications enable row level security;

-- Read-only for members; writes happen through security-definer
-- functions, so a member cannot forge or rewrite a notification.
create policy "members can view org notifications"
  on public.notifications for select
  using (public.is_org_member(org_id));

create function public.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id
  from public.memberships where user_id = auth.uid() limit 1;

  if v_org_id is null then
    raise exception 'not_authorized';
  end if;

  update public.notifications
  set read_at = now()
  where org_id = v_org_id and read_at is null;
end;
$$;

revoke all on function public.mark_notifications_read() from public;
grant execute on function public.mark_notifications_read() to authenticated;

-- ---------------------------------------------------------------------
-- Pending deletions. Row present = deletion scheduled; deleting the row
-- is the undo. ON DELETE CASCADE so a purged user takes their own row.
-- ---------------------------------------------------------------------
create table public.account_deletions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kind text not null check (kind in ('customer', 'owner')),
  requested_at timestamptz not null default now(),
  purge_after timestamptz not null default now() + interval '15 days'
);

alter table public.account_deletions enable row level security;

create policy "users can see their own deletion request"
  on public.account_deletions for select
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- request_account_deletion(): schedule deletion, cancel future bookings
-- now, and tell every affected clinic now.
-- ---------------------------------------------------------------------
create function public.request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org_id uuid;
  v_kind text;
  v_purge_after timestamptz;
  r record;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select org_id into v_org_id
  from public.memberships
  where user_id = v_uid and role = 'owner'
  limit 1;

  v_kind := case when v_org_id is null then 'customer' else 'owner' end;

  insert into public.account_deletions (user_id, kind)
  values (v_uid, v_kind)
  on conflict (user_id) do update set kind = excluded.kind
  returning purge_after into v_purge_after;

  if v_kind = 'customer' then
    -- Cancel this customer's future bookings and notify each clinic, one
    -- notification per booking so the clinic sees which slot freed up.
    for r in
      update public.appointments a
      set status = 'cancelled'
      where a.customer_user_id = v_uid
        and a.status = 'booked'
        and a.start_at > now()
      returning a.id, a.org_id, a.customer_name, a.start_at
    loop
      insert into public.notifications (org_id, kind, title, body, appointment_id)
      values (
        r.org_id,
        'booking_cancelled',
        r.customer_name,
        to_char(r.start_at, 'YYYY-MM-DD HH24:MI'),
        r.id
      );
    end loop;
  else
    -- An owner deleting their account takes the clinic with it: hide it
    -- from the marketplace at once and cancel everything still upcoming,
    -- so no customer keeps a booking at a clinic that is closing. No
    -- notification here — the clinic is the one leaving.
    update public.organizations set deleted_at = now() where id = v_org_id;

    update public.appointments
    set status = 'cancelled'
    where org_id = v_org_id and status = 'booked' and start_at > now();
  end if;

  return v_purge_after;
end;
$$;

revoke all on function public.request_account_deletion() from public;
grant execute on function public.request_account_deletion() to authenticated;

-- ---------------------------------------------------------------------
-- cancel_account_deletion(): undo, only inside the grace window.
-- Deliberately does NOT un-cancel the bookings — those slots may already
-- have been taken by someone else, so silently reinstating them could
-- double-book. Say so in the UI instead of pretending.
-- ---------------------------------------------------------------------
create function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_kind text;
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select kind into v_kind
  from public.account_deletions
  where user_id = v_uid and purge_after > now();

  if v_kind is null then
    raise exception 'no_pending_deletion';
  end if;

  if v_kind = 'owner' then
    select org_id into v_org_id
    from public.memberships where user_id = v_uid and role = 'owner' limit 1;
    if v_org_id is not null then
      update public.organizations set deleted_at = null where id = v_org_id;
    end if;
  end if;

  delete from public.account_deletions where user_id = v_uid;
end;
$$;

revoke all on function public.cancel_account_deletion() from public;
grant execute on function public.cancel_account_deletion() to authenticated;

-- ---------------------------------------------------------------------
-- purge_due_accounts(): the real deletion, once the 15 days are up.
-- Secret-gated exactly like claim_due_reminders (0009) — called from
-- /api/cron/purge-accounts with an anon client and no user session.
-- Deleting the auth user cascades to customers, memberships and
-- push_subscriptions, and NULLs appointments.customer_user_id thanks to
-- the constraint swapped at the top of this migration.
-- ---------------------------------------------------------------------
create function public.purge_due_accounts(p_secret text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_secret is distinct from (select value from public.app_config where key = 'cron_secret') then
    raise exception 'not_authorized';
  end if;

  with due as (
    select user_id from public.account_deletions where purge_after <= now()
  ), gone as (
    delete from auth.users u using due where u.id = due.user_id returning u.id
  )
  select count(*)::int into v_count from gone;

  return v_count;
end;
$$;

revoke all on function public.purge_due_accounts(text) from public;
grant execute on function public.purge_due_accounts(text) to anon, authenticated;
