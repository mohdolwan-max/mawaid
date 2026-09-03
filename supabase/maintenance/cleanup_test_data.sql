-- One-off cleanup of accumulated TEST data, 2026-09-03. Not a migration:
-- this deletes rows, not schema, and runs exactly once.
--
-- Two-step by design (ENGINEERING-STANDARDS: propose, then apply):
-- SECTION 1 only reads — run it, look at what it names, and only then
-- run SECTION 2, which deletes precisely the same sets.
--
-- Deliberately NOT touched:
--   * the six demo clinics (عرض توضيحي) — they are the storefront;
--     their SEEDED bookings/reviews (ids d0000...) stay too;
--   * org `moon` and everything on it — the owner's own live test
--     clinic, his to keep or kill separately;
--   * any real customer data (there is none yet — that is the point of
--     cleaning now).
-- =====================================================================


-- =====================================================================
-- SECTION 1 — PREVIEW. Read-only. Run this first.
-- =====================================================================
select 'org to delete' as what, o.slug as detail, count(a.id)::text as extra
from public.organizations o
left join public.appointments a on a.org_id = o.id
where o.slug in ('qa-test-clinic', 'test-clinic-smoketest')
group by o.slug

union all

select 'auth user to delete', u.email,
       coalesce((select 'customer row' from public.customers c where c.user_id = u.id), '—')
from auth.users u
where u.email in (
  'mawaid.qa.clinic@gmail.com',
  'mawaid.qa.clinic2@gmail.com',
  'mohdolwan+mawaidtest2@gmail.com',
  'mohdolwan+mawaidtest3@gmail.com',
  'mohdolwan+mawaidtest4@gmail.com',
  'mohdolwan+mawaidtest5@gmail.com',
  'mohdolwan+mawaidtest6@gmail.com',
  'mohdolwan+mawaidtest7@gmail.com',
  'mohdolwan+mawaidcust1@gmail.com',
  'mawaid.qa.customer@gmail.com'
)

union all

-- Bookings someone entered on the DEMO clinics while testing today —
-- everything there whose id is not from the seed (seed ids = d0000…).
select 'stray demo booking', o.slug || ' · ' || a.customer_name,
       to_char(a.start_at, 'MM-DD HH24:MI') || ' · ' || a.status
from public.appointments a
join public.organizations o on o.id = a.org_id
where o.slug like 'demo-%'
  and a.id::text not like 'd0000%'

union all

-- The auditor's bookings, both rounds: the guest booking and the
-- second-round review test.
select 'QA booking', o.slug || ' · ' || a.customer_name, a.status
from public.appointments a
join public.organizations o on o.id = a.org_id
where a.customer_name in ('اختبار QA', 'نور للتقييم')

union all

-- Second-round finding: the auditor switched this org's directory listing
-- ON, so a test clinic carrying a fabricated 5-star review sat at the
-- TOP of the live directory. Unlist immediately (line below Section 1);
-- the org itself goes with Section 2.
select 'LISTED PUBLICLY — unlist now', o.slug, o.name
from public.organizations o
where o.slug = 'qa-test-clinic' and o.is_listed
order by 1, 2;


-- Reversible, and does not wait for the rest of the cleanup:
-- update public.organizations set is_listed = false where slug = 'qa-test-clinic';


-- =====================================================================
-- SECTION 2 — APPLY. Run ONLY after Section 1 looked right.
-- Same sets, in dependency order, one transaction: all or nothing.
-- =====================================================================
-- begin;
--
-- delete from public.appointments a
-- using public.organizations o
-- where o.id = a.org_id
--   and o.slug like 'demo-%'
--   and a.id::text not like 'd0000%';
--
-- delete from public.appointments
-- where customer_name in ('اختبار QA', 'نور للتقييم');
--
-- -- Orgs: 9 child tables cascade (appointments, services, staff_*,
-- -- reviews, notifications, org_settings, memberships, invitations).
-- delete from public.organizations
-- where slug in ('qa-test-clinic', 'test-clinic-smoketest');
--
-- -- Auth users: customers + push_subscriptions cascade; appointment
-- -- links go set-null (0024/0025), so nothing blocks.
-- delete from auth.users
-- where email in (
--   'mawaid.qa.clinic@gmail.com',
--   'mawaid.qa.clinic2@gmail.com',
--   'mohdolwan+mawaidtest2@gmail.com',
--   'mohdolwan+mawaidtest3@gmail.com',
--   'mohdolwan+mawaidtest4@gmail.com',
--   'mohdolwan+mawaidtest5@gmail.com',
--   'mohdolwan+mawaidtest6@gmail.com',
--   'mohdolwan+mawaidtest7@gmail.com',
--   'mohdolwan+mawaidcust1@gmail.com',
--   'mawaid.qa.customer@gmail.com'
-- );
--
-- commit;
--
-- -- Then re-run Section 1: every bucket must come back EMPTY.
