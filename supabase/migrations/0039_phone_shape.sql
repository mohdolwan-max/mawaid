-- A booking's phone number must be a shape that can actually receive a
-- reminder. Until now NOTHING checked it: _norm_phone stripped the
-- punctuation and stored whatever digits were left, so '1' became '01'
-- and was accepted, and a mistyped number produced a booking the clinic
-- could not confirm, the customer could not cancel, and nobody could
-- undo (owner, 2026-09-03).
--
-- Jordan mobile (07 + 8) and Egypt mobile (01 + 9) — the two markets the
-- product serves. Landlines are deliberately excluded: the number's job
-- here is to receive a reminder. Widening this later is one regex.
--
-- This is the BACKSTOP, not the user experience: the booking form checks
-- the same rule client-side (src/lib/phone.ts, same folding, tested
-- directly) so a customer gets a sentence rather than a database error.
-- The constraint is what stops someone calling book_appointment straight
-- through PostgREST, which the form's validation obviously cannot.
-- =====================================================================

-- NOT VALID on purpose: existing rows are test data with foreign and
-- garbage numbers (a Saudi 05… among them) and are about to be deleted
-- by supabase/maintenance/cleanup_test_data.sql. NOT VALID skips only
-- the scan of old rows — every INSERT and UPDATE from now on is checked.
alter table public.appointments
  drop constraint if exists appointments_phone_shape;

alter table public.appointments
  add constraint appointments_phone_shape check (
    public._norm_phone(customer_phone) ~ '^07[0-9]{8}$'
    or public._norm_phone(customer_phone) ~ '^01[0-9]{9}$'
  ) not valid;

-- _norm_phone is IMMUTABLE (0027) so a CHECK may call it, and 0028's
-- revoke does not bite: 0034 removed INSERT on appointments from every
-- session role, so the only writer left is book_appointment, which is
-- SECURITY DEFINER and runs as the function owner.

-- ---------------------------------------------------------------------
-- Verify after applying — the first must fail, the rest must pass:
-- ---------------------------------------------------------------------
-- select public._norm_phone('1');                     -- '01'  → rejected
-- select public._norm_phone('+962 79 123 4567');      -- '0791234567' → ok
-- select public._norm_phone('٠٧٩١٢٣٤٥٦٧');            -- '0791234567' → ok
-- select public._norm_phone('+20 101 234 5678');      -- '01012345678' → ok
--
-- And end to end (expect: new row violates appointments_phone_shape):
-- insert into public.appointments (org_id, service_id, customer_name,
--   customer_phone, start_at, end_at)
-- select id, (select id from public.services where org_id = o.id limit 1),
--        'اختبار الرقم', '1', now() + interval '2 days',
--        now() + interval '2 days 30 minutes'
-- from public.organizations o where o.slug = 'moon';
