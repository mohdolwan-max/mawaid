-- Finish the sweep 0034 started. That migration fixed the three tables
-- an audit had named; this one asks the question systematically — WHICH
-- table carries org_id AND a pointer to another org-scoped row? — and
-- closes the two it turns out 0034 missed.
--
-- Neither is exploitable today, and that is precisely why they are worth
-- constraining: both are currently held shut by a READER remembering to
-- check, which is the arrangement 0034 rejected. A constraint makes the
-- bad row impossible to write; a careful reader only makes today's
-- readers safe and leaves the next one to rediscover the hole.
--
-- The full sweep, for the record:
--   appointments    → services   ← GAP, fixed below
--                   → memberships  (0034)
--   invitations     → memberships ← GAP, fixed below
--   staff_services  → memberships, services (0034)
--   staff_time_off  → memberships (0034)
--   reviews         → appointments  — safe: SELECT-only policy, so no
--                     session can write it at all; submit_review is
--                     SECURITY DEFINER and takes org_id FROM the
--                     appointment, where it cannot disagree.
--   notifications   → appointments  — safe for the same reason: no write
--                     policy exists; the 0029 trigger is the only writer.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. appointments.service_id must belong to the appointment's org.
--
-- book_appointment already refuses a foreign service ("service_not_found"
-- comes from a lookup scoped by org_id), and 0034 removed INSERT on this
-- table from every session role — so the only writer is the definer that
-- checks. This makes it structural rather than remembered.
--
-- services already has the (id, org_id) unique key 0034 added.
-- ---------------------------------------------------------------------
delete from public.appointments a
where not exists (
  select 1 from public.services sv
  where sv.id = a.service_id and sv.org_id = a.org_id
);

alter table public.appointments
  drop constraint if exists appointments_service_same_org;
alter table public.appointments
  add constraint appointments_service_same_org
  foreign key (service_id, org_id)
  references public.services (id, org_id);


-- ---------------------------------------------------------------------
-- 2. invitations.membership_id must belong to the inviting org.
--
-- invitations is the one org-scoped table still writable straight from a
-- session: its policy is `for all` on is_org_owner(org_id), so an owner
-- can write a row naming their own org while pointing membership_id at
-- somebody else's staff row.
--
-- Today that row is inert — get_my_context's accept path re-checks
-- `and org_id = v_invite.org_id` before adopting the membership, and
-- `and user_id is null` stops it taking over an account that already has
-- a login. Verified by reading 0022. But the protection lives entirely
-- in that one reader; if a second accept path is ever written, or that
-- clause is ever "simplified", the row is waiting.
-- ---------------------------------------------------------------------
update public.invitations i
   set membership_id = null
 where i.membership_id is not null
   and not exists (
     select 1 from public.memberships m
     where m.id = i.membership_id and m.org_id = i.org_id
   );

alter table public.invitations
  drop constraint if exists invitations_membership_same_org;
-- ON DELETE CASCADE, matching the single-column FK the column already
-- carries (0022). Two foreign keys over the same column with DIFFERENT
-- delete actions is a contradiction Postgres has to resolve on every
-- membership deletion — 0034 kept its composite keys in step with the
-- existing ones for exactly this reason, and so does this.
alter table public.invitations
  add constraint invitations_membership_same_org
  foreign key (membership_id, org_id)
  references public.memberships (id, org_id) on delete cascade;


-- ---------------------------------------------------------------------
-- Verify after applying: six same-org constraints, three tables' worth
-- from 0034 plus the two here.
-- ---------------------------------------------------------------------
-- select conname, conrelid::regclass as on_table
-- from pg_constraint
-- where conname like '%_same_org'
-- order by conname;
-- -- expect: appointments_service_same_org, appointments_staff_same_org,
-- --         invitations_membership_same_org, staff_services_service_same_org,
-- --         staff_services_staff_same_org, staff_time_off_staff_same_org
--
-- And the sweep must come back EMPTY — no org-scoped table left with a
-- cross-tenant pointer that has no composite key behind it:
--
-- select c.conrelid::regclass as tbl, a.attname
-- from pg_constraint c
-- join unnest(c.conkey) k(attnum) on true
-- join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
-- where c.contype = 'f'
--   and a.attname in ('staff_membership_id','service_id','staff_id','membership_id','appointment_id')
--   and exists (select 1 from pg_attribute o where o.attrelid = c.conrelid and o.attname = 'org_id')
--   and array_length(c.conkey, 1) = 1
--   and c.conrelid::regclass::text not in ('reviews','notifications')
-- order by 1, 2;
