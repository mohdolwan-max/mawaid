-- Four findings from the external audit, all re-verified in this schema
-- before being fixed. Three are privilege problems with the same shape:
-- RLS decides WHICH ROWS you may touch, and nothing decided WHICH
-- COLUMNS — so "you own this org" quietly meant "you may write anything
-- about this org", including the fields the business model depends on.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. WORST OF THE FOUR: one clinic can make a competitor unbookable.
--
-- staff_services and staff_time_off both carry org_id AND a pointer to a
-- membership/service — but nothing ties the two together. The RLS check
-- is `is_org_owner(org_id)`, so a free account that owns org A may
-- insert a row claiming org_id = A while pointing at org B's service or
-- B's staff member. Both ids are PUBLIC: list_public_services returns
-- service ids and list_public_staff_for_service returns membership ids.
-- No guessing required.
--
-- What makes it fatal rather than untidy is that the readers never scope
-- by org either. From book_appointment (0027):
--
--   not exists (select 1 from staff_services ss where ss.service_id = p_service_id)
--   or exists (select 1 from staff_services ss where ss.service_id = p_service_id
--                                               and ss.staff_membership_id = m.id)
--
-- Insert one row pointing at B's service and that service flips to
-- "assigned staff only", with the only assigned staff belonging to A.
-- Every one of B's own staff now fails the second test: the service
-- becomes permanently unbookable. The staff_time_off reader has the same
-- shape (`where t.staff_membership_id = p_staff_id`), so a single row
-- marks a competitor's specialist away until 2099.
--
-- The victim sees no attacker, no error, and nothing wrong in their own
-- dashboard — just an empty slot grid.
--
-- Fixed with composite foreign keys rather than by patching the two
-- readers: a constraint makes the bad row impossible to write, while a
-- fixed reader only makes today's readers safe and leaves the next one
-- to rediscover this.
-- ---------------------------------------------------------------------

-- Composite FK targets. Both are redundant with the primary keys, which
-- is exactly why they are safe to add.
alter table public.memberships
  drop constraint if exists memberships_id_org_key;
alter table public.memberships
  add constraint memberships_id_org_key unique (id, org_id);

alter table public.services
  drop constraint if exists services_id_org_key;
alter table public.services
  add constraint services_id_org_key unique (id, org_id);

-- Heal any row that already crosses tenants before adding the
-- constraints, so the ALTER cannot fail on existing data. On a clean
-- database this deletes nothing.
delete from public.staff_services ss
where not exists (
  select 1 from public.memberships m
  where m.id = ss.staff_membership_id and m.org_id = ss.org_id
) or not exists (
  select 1 from public.services sv
  where sv.id = ss.service_id and sv.org_id = ss.org_id
);

delete from public.staff_time_off t
where not exists (
  select 1 from public.memberships m
  where m.id = t.staff_membership_id and m.org_id = t.org_id
);

alter table public.staff_services
  drop constraint if exists staff_services_staff_same_org;
alter table public.staff_services
  add constraint staff_services_staff_same_org
  foreign key (staff_membership_id, org_id)
  references public.memberships (id, org_id) on delete cascade;

alter table public.staff_services
  drop constraint if exists staff_services_service_same_org;
alter table public.staff_services
  add constraint staff_services_service_same_org
  foreign key (service_id, org_id)
  references public.services (id, org_id) on delete cascade;

alter table public.staff_time_off
  drop constraint if exists staff_time_off_staff_same_org;
alter table public.staff_time_off
  add constraint staff_time_off_staff_same_org
  foreign key (staff_membership_id, org_id)
  references public.memberships (id, org_id) on delete cascade;

-- appointments.staff_id too. staff_id is nullable and the default
-- MATCH SIMPLE skips the check when any column is NULL, so "any
-- available staff" bookings are unaffected.
alter table public.appointments
  drop constraint if exists appointments_staff_same_org;
alter table public.appointments
  add constraint appointments_staff_same_org
  foreign key (staff_id, org_id)
  references public.memberships (id, org_id);


-- ---------------------------------------------------------------------
-- 2. The owner could rewrite the fields the business runs on.
--
-- `owner can update their organization` restricts rows and says nothing
-- about columns, and no column-level grant was ever issued — so the
-- table-wide grant covers every column. Through PostgREST an owner could
-- set plan = 'business' (the 10 JOD stops being collectable), take a
-- reserved slug like 'search' (reserved_slugs is only consulted inside
-- create_organization), or clear deleted_at to undo a closure.
--
-- Granting the columns the product actually lets an owner edit is
-- enough; everything else stays unwritable from a session. The functions
-- that legitimately move plan/slug/deleted_at are SECURITY DEFINER and
-- run as the owner of the function, so they are unaffected.
-- ---------------------------------------------------------------------
revoke update on public.organizations from anon, authenticated;
grant update (
  name, address, phone, logo_url, cover_image_url, maps_url,
  category, city, district, description, price_tier, is_listed,
  lat, lng
) on public.organizations to authenticated;


-- ---------------------------------------------------------------------
-- 3. A clinic could write its own five-star reviews, without limit.
--
-- submit_review treats possession of a cancel_token as proof of being
-- the customer — correct for a guest with an emailed link, and the only
-- thing it otherwise checks is status = 'completed'. But members can
-- SELECT every column of their own appointments, cancel_token included,
-- and can set status themselves. So: enter a booking under an invented
-- name, mark it completed, read the token, post five stars. Repeat.
-- hide_review then buries anything genuine and negative.
--
-- No application query reads cancel_token as a member (checked across
-- src/app/(app)); the customer's own list goes through list_my_bookings,
-- which is SECURITY DEFINER and unaffected. So the column can simply
-- leave the session's reach.
--
-- UPDATE is narrowed to status for the same reason: with the column
-- writable, an owner could set cancel_token to a value they chose and
-- walk straight back in. Rescheduling goes through reschedule_booking
-- (SECURITY DEFINER), so nothing legitimate needs more than this.
-- INSERT and DELETE are revoked outright rather than narrowed: with
-- INSERT an owner could write a row carrying a cancel_token THEY chose —
-- the same forgery through a different door — and nothing legitimate
-- does either directly: every booking enters through book_appointment,
-- and rows are cancelled by status, never deleted (purge is definer).
-- ---------------------------------------------------------------------
revoke select, insert, update, delete on public.appointments from anon, authenticated;
grant select (
  id, org_id, service_id, staff_id, resource_id, visit_id,
  customer_name, customer_phone, customer_email, customer_user_id,
  start_at, end_at, status, notes,
  reminder_sent_at, created_at, updated_at
) on public.appointments to authenticated;
grant update (status) on public.appointments to authenticated;


-- ---------------------------------------------------------------------
-- 4. Anyone could send mail from your domain to any address.
--
-- book_appointment accepts customer_email as free text and the booking
-- action then sends a confirmation from the product's own sender. With
-- no format check, an anonymous caller can aim that at any inbox with an
-- attacker-chosen name in the body — a spam vector wearing your domain,
-- and a fast way to lose sender reputation before launch.
--
-- Existing bad rows are nulled first so the constraint cannot fail on
-- data already stored. NULL stays allowed: email is genuinely optional.
-- ---------------------------------------------------------------------
update public.appointments
   set customer_email = null
 where customer_email is not null
   and customer_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';

alter table public.appointments
  drop constraint if exists appointments_email_format;
alter table public.appointments
  add constraint appointments_email_format check (
    customer_email is null
    or customer_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  );


-- ---------------------------------------------------------------------
-- Verify after applying. Every row must read as described.
-- ---------------------------------------------------------------------
-- -- cancel_token must NOT appear for authenticated:
-- select column_name from information_schema.column_privileges
--  where table_name = 'appointments' and grantee = 'authenticated'
--    and privilege_type = 'SELECT' and column_name = 'cancel_token';   -- expect 0 rows
--
-- -- plan/slug/deleted_at must NOT be updatable by authenticated:
-- select column_name from information_schema.column_privileges
--  where table_name = 'organizations' and grantee = 'authenticated'
--    and privilege_type = 'UPDATE'
--    and column_name in ('plan','slug','deleted_at');                  -- expect 0 rows
--
-- -- the four cross-tenant constraints exist:
-- select conname from pg_constraint
--  where conname in ('staff_services_staff_same_org','staff_services_service_same_org',
--                    'staff_time_off_staff_same_org','appointments_staff_same_org');
--
-- NOT fixed here, and named so it is not mistaken for done: the booking
-- rate limit is still keyed on the phone number alone, so rotating the
-- number still gets a fresh allowance. Closing that properly needs a
-- per-IP limit in front of the route, which is application work rather
-- than a grant.
