-- =====================================================================
-- Six demo clinics, so the category chips have something behind them.
--
-- This is a SEED, not a migration. It lives outside supabase/migrations/
-- on purpose: it is data, it is meant to be deleted again, and it must
-- never run as part of a schema deploy.
--
-- Paste it whole into the Supabase SQL editor. It runs as `postgres`,
-- which owns these tables and bypasses RLS — none of the seeded tables
-- has an INSERT policy, so this cannot work from the app, an RPC, or any
-- anon/authenticated client. That is intentional.
--
-- It is wrapped in one transaction and BEGINS BY DELETING ITS OWN ROWS,
-- so running it twice is safe and leaves exactly one copy. Nothing in
-- here is idempotent on its own: services have no unique key at all, and
-- memberships' unique(org_id, user_id) is inert when user_id is NULL
-- (NULLs are distinct), so a re-run without the teardown would duplicate
-- every service and silently double each clinic's booking capacity.
--
-- TO REMOVE EVERYTHING LATER, run section 0 on its own.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. TEARDOWN — also the "undo" block. Safe to run alone.
-- ---------------------------------------------------------------------

-- push_subscriptions.appointment_id is ON DELETE CASCADE, and the table
-- holds ONE ROW PER BROWSER (endpoint is unique), not one per booking.
-- If a real person enabled reminders while looking at a demo booking,
-- their only subscription row points at a demo appointment — and the
-- cascade below would silently kill reminders for their real bookings at
-- real clinics. Detach them first. The delete has to come before the
-- update because `linked_to_something` forbids a row with neither a
-- customer nor an appointment.
delete from public.push_subscriptions
where customer_user_id is null
  and appointment_id in (
    select a.id from public.appointments a
    join public.organizations o on o.id = a.org_id
    where o.slug like 'demo-%'
  );

update public.push_subscriptions set appointment_id = null
where appointment_id in (
    select a.id from public.appointments a
    join public.organizations o on o.id = a.org_id
    where o.slug like 'demo-%'
  );

-- Everything else goes by cascade. Every foreign key pointing at
-- organizations(id) is ON DELETE CASCADE — org_settings, memberships,
-- services, invitations, staff_services, appointments, reviews,
-- staff_time_off, notifications — so one statement is enough.
--
-- appointments.service_id and appointments.staff_id are the schema's
-- only two FKs with no ON DELETE clause, which is what aborted the
-- account purge in 0024. It does not bite here: deleting an ORGANIZATION
-- cascades to services, memberships and appointments in the same
-- statement, and NO ACTION checks are drained at end of statement (that
-- deferral is exactly what separates NO ACTION from RESTRICT).
--
-- Not deleted_at — that is the product's "close clinic" path and only
-- hides the rows.
delete from public.organizations where slug like 'demo-%';


-- ---------------------------------------------------------------------
-- 0b. The old smoke-test clinic — hidden, not deleted.
--
-- test-clinic-smoketest is publicly listed on the live marketplace with
-- a fake five-star review, and 0011_localize_jordan only remapped its
-- city KEY: its address still reads "الرياض", its district is "حي
-- العليا" (a Riyadh district) and its phone is in Saudi 05… format. So
-- the profile page contradicts itself — "الرياض" under the name,
-- "حي العليا · عمّان" in the chip.
--
-- is_listed = false removes it from the directory and both home rows
-- immediately, and is reversible with one statement. Its direct URL
-- still resolves, so nothing that links to it breaks.
--
-- To put it back:   update public.organizations
--                     set is_listed = true where slug = 'test-clinic-smoketest';
-- To delete it for good, run the push_subscriptions block above with
-- 'test-clinic-smoketest' in place of 'demo-%', then:
--                   delete from public.organizations
--                     where slug = 'test-clinic-smoketest';
-- ---------------------------------------------------------------------
update public.organizations
set is_listed = false
where slug = 'test-clinic-smoketest';


-- ---------------------------------------------------------------------
-- 1. organizations
--
-- is_listed defaults to FALSE, so it must be set explicitly or the rows
-- exist and appear nowhere. category and city have no CHECK and no
-- foreign key — a typo matches nothing, silently, which is the very bug
-- this seed exists to disprove. The keys below are copied from
-- src/lib/directory.ts; salon_women is the only one with an underscore.
--
-- Names all carry (عرض توضيحي). That field is the one thing that reaches
-- the card, the profile heading, the booking bar, the confirmation email
-- subject and the push notification — so if a real person ever books
-- one of these, every surface they see says it is a demo.
--
-- cover_image_url points at same-origin SVGs added in public/demo/. The
-- CSP is img-src 'self' data: blob: https://<supabase host>, so an
-- external image URL (Unsplash and friends) is blocked and renders
-- broken. logo_url reuses the category photos already in public/icons/.
-- maps_url stays NULL on purpose: a real map link under a fake clinic
-- name would send real customers to a real business.
-- ---------------------------------------------------------------------
insert into public.organizations
  (id, name, slug, address, phone, category, city, district, description,
   price_tier, is_listed, logo_url, cover_image_url, created_at)
values
  ('a0000001-0000-4000-8000-000000000001',
   'عيادة نبض الجلدية (عرض توضيحي)', 'demo-nabd-derma',
   'شارع عبدالله غوشة، عبدون، عمّان', '0790000001',
   'derma', 'amman', 'عبدون',
   'عيادة جلدية متخصصة في علاج البشرة والشعر والتجميل غير الجراحي، بإشراف استشاريين معتمدين. تشمل الخدمات الاستشارات التشخيصية وجلسات العناية بالبشرة والحقن التجميلي.',
   3, true, '/icons/derma.webp', '/demo/derma.svg', now() - interval '55 days'),

  ('a0000002-0000-4000-8000-000000000002',
   'صالون لمسة أنيقة (عرض توضيحي)', 'demo-lamsa-salon',
   'شارع المدينة المنورة، خلدا، عمّان', '0790000002',
   'salon_women', 'amman', 'خلدا',
   'صالون نسائي متكامل يقدّم قص وتصفيف الشعر والصبغات ومكياج المناسبات والعناية بالأظافر، في أجواء هادئة ومخصّصة للسيدات فقط.',
   2, true, '/icons/beauty.webp', '/demo/salon_women.svg', now() - interval '48 days'),

  ('a0000003-0000-4000-8000-000000000003',
   'حلاقة الفرسان (عرض توضيحي)', 'demo-forsan-barber',
   'شارع خالد بن الوليد، جبل الحسين، عمّان', '0790000003',
   'barber', 'amman', 'جبل الحسين',
   'صالون حلاقة رجالي بخدمة سريعة وأسعار مناسبة، يشمل قص الشعر وتهذيب الذقن والحمام المغربي للرجال.',
   1, true, '/icons/barber.webp', '/demo/barber.svg', now() - interval '40 days'),

  ('a0000004-0000-4000-8000-000000000004',
   'واحة الاسترخاء سبا (عرض توضيحي)', 'demo-waha-spa',
   'شارع الشريف عبدالحميد شرف، الشميساني، عمّان', '0790000004',
   'spa', 'amman', 'الشميساني',
   'مركز سبا يقدّم جلسات المساج العلاجي والاسترخائي والحمام المغربي والساونا، بأيدي أخصائيات مدرّبات وفي أجواء هادئة.',
   3, true, '/icons/spa.webp', '/demo/spa.svg', now() - interval '32 days'),

  ('a0000005-0000-4000-8000-000000000005',
   'مركز العافية للعلاج الطبيعي (عرض توضيحي)', 'demo-afia-physio',
   'شارع الجامعة، إربد', '0790000005',
   'physio', 'irbid', 'شارع الجامعة',
   'مركز علاج طبيعي وإعادة تأهيل يعالج آلام الظهر والرقبة وإصابات الملاعب وما بعد العمليات، ببرامج فردية يشرف عليها أخصائيون.',
   2, true, '/icons/physio.webp', '/demo/physio.svg', now() - interval '25 days'),

  -- Laser is one of the strongest categories in this market, and
  -- hiding the old smoke-test org left its chip empty, so it gets a
  -- clinic of its own rather than being the one gap on the home page.
  ('a0000006-0000-4000-8000-000000000006',
   'مركز لمى للليزر والتجميل (عرض توضيحي)', 'demo-luma-laser',
   'شارع مكة، الصويفية، عمّان', '0790000006',
   'laser', 'amman', 'الصويفية',
   'مركز متخصص في إزالة الشعر بالليزر وتقنيات نضارة البشرة، بأجهزة حديثة وكوادر مدرّبة. جلسات مخصصة حسب نوع البشرة مع استشارة مجانية قبل البدء.',
   3, true, '/icons/laser.webp', '/demo/laser.svg', now() - interval '18 days');


-- ---------------------------------------------------------------------
-- 2. org_settings — one per org, and NOT optional.
--
-- get_public_org() INNER JOINs this table while list_directory_orgs()
-- never touches it. An org without a settings row therefore renders a
-- perfect directory card and 404s the moment anyone taps it.
--
-- timezone is written explicitly: 0001's column default was
-- 'Asia/Riyadh' and 0011 changed the DEFAULT, so relying on it is fine
-- today but says nothing about intent.
--
-- business_hours is keyed 0=Sunday..6=Saturday. All seven keys must be
-- present — a missing key reads as closed, silently. Key "5" is Friday.
-- Every clinic's open window is longer than its longest service, or that
-- service would show an empty grid with no error.
-- ---------------------------------------------------------------------
insert into public.org_settings
  (org_id, lang, timezone, business_hours,
   slot_interval_minutes, min_notice_minutes, max_advance_days, wizard_done)
values
  -- Dermatology: Sun–Thu 10–20, Fri closed, Sat 10–16.
  ('a0000001-0000-4000-8000-000000000001', 'ar', 'Asia/Amman', '{
     "0": {"open":"10:00","close":"20:00","closed":false},
     "1": {"open":"10:00","close":"20:00","closed":false},
     "2": {"open":"10:00","close":"20:00","closed":false},
     "3": {"open":"10:00","close":"20:00","closed":false},
     "4": {"open":"10:00","close":"20:00","closed":false},
     "5": {"open":"10:00","close":"20:00","closed":true},
     "6": {"open":"10:00","close":"16:00","closed":false}
   }'::jsonb, 15, 60, 30, true),

  -- Ladies salon: Sat–Thu 10–21, Fri closed.
  ('a0000002-0000-4000-8000-000000000002', 'ar', 'Asia/Amman', '{
     "0": {"open":"10:00","close":"21:00","closed":false},
     "1": {"open":"10:00","close":"21:00","closed":false},
     "2": {"open":"10:00","close":"21:00","closed":false},
     "3": {"open":"10:00","close":"21:00","closed":false},
     "4": {"open":"10:00","close":"21:00","closed":false},
     "5": {"open":"10:00","close":"21:00","closed":true},
     "6": {"open":"10:00","close":"21:00","closed":false}
   }'::jsonb, 15, 60, 30, true),

  -- Barbershop: Sat–Thu 09–22, Fri afternoon only.
  ('a0000003-0000-4000-8000-000000000003', 'ar', 'Asia/Amman', '{
     "0": {"open":"09:00","close":"22:00","closed":false},
     "1": {"open":"09:00","close":"22:00","closed":false},
     "2": {"open":"09:00","close":"22:00","closed":false},
     "3": {"open":"09:00","close":"22:00","closed":false},
     "4": {"open":"09:00","close":"22:00","closed":false},
     "5": {"open":"14:00","close":"22:00","closed":false},
     "6": {"open":"09:00","close":"22:00","closed":false}
   }'::jsonb, 15, 30, 30, true),

  -- Spa: Sat–Thu 11–22, Fri afternoon only.
  ('a0000004-0000-4000-8000-000000000004', 'ar', 'Asia/Amman', '{
     "0": {"open":"11:00","close":"22:00","closed":false},
     "1": {"open":"11:00","close":"22:00","closed":false},
     "2": {"open":"11:00","close":"22:00","closed":false},
     "3": {"open":"11:00","close":"22:00","closed":false},
     "4": {"open":"11:00","close":"22:00","closed":false},
     "5": {"open":"14:00","close":"22:00","closed":false},
     "6": {"open":"11:00","close":"22:00","closed":false}
   }'::jsonb, 15, 120, 45, true),

  -- Physiotherapy: Sun–Thu 09–17, weekend closed.
  ('a0000005-0000-4000-8000-000000000005', 'ar', 'Asia/Amman', '{
     "0": {"open":"09:00","close":"17:00","closed":false},
     "1": {"open":"09:00","close":"17:00","closed":false},
     "2": {"open":"09:00","close":"17:00","closed":false},
     "3": {"open":"09:00","close":"17:00","closed":false},
     "4": {"open":"09:00","close":"17:00","closed":false},
     "5": {"open":"09:00","close":"17:00","closed":true},
     "6": {"open":"09:00","close":"17:00","closed":true}
   }'::jsonb, 15, 120, 30, true),

  -- Laser: Sat-Thu 11-21, Fri closed.
  ('a0000006-0000-4000-8000-000000000006', 'ar', 'Asia/Amman', '{
     "0": {"open":"11:00","close":"21:00","closed":false},
     "1": {"open":"11:00","close":"21:00","closed":false},
     "2": {"open":"11:00","close":"21:00","closed":false},
     "3": {"open":"11:00","close":"21:00","closed":false},
     "4": {"open":"11:00","close":"21:00","closed":false},
     "5": {"open":"11:00","close":"21:00","closed":true},
     "6": {"open":"11:00","close":"21:00","closed":false}
   }'::jsonb, 15, 120, 45, true);


-- ---------------------------------------------------------------------
-- 3. memberships — two per clinic, with NO user account.
--
-- At least one is mandatory: since 0013 the "any available staff" branch
-- of get_available_slots joins memberships, so an org with none returns
-- zero slots on every date forever, and book_appointment falls straight
-- through its candidate loop to raise slot_taken. The clinic looks
-- perfect and cannot be booked.
--
-- user_id = NULL is a supported state, not a trick: 0022 dropped the NOT
-- NULL precisely so staff without an email could exist, add_staff_member
-- inserts exactly this shape, and 0025 re-pointed the FK to ON DELETE
-- SET NULL. It grants nobody anything — is_org_member and is_org_owner
-- both compare user_id = auth.uid(), and NULL = anything is never true.
--
-- role is written as 'staff' because the column DEFAULTS to 'owner';
-- omitting it would mint fake owners, and remove_staff_member refuses to
-- delete an owner row.
--
-- No real auth user is attached, including the account that owns this
-- project: get_my_context() does `where m.user_id = auth.uid() limit 1`
-- with no ORDER BY, so a second membership would make the real dashboard
-- land on an arbitrary clinic.
--
-- display_name is required in practice — list_public_staff_for_service
-- filters out staff without one, so the specialist step would be empty.
-- business_hours is left NULL, which means "inherit the clinic's hours".
-- ---------------------------------------------------------------------
insert into public.memberships (id, org_id, user_id, role, display_name, title)
values
  ('b0000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', null, 'staff', 'د. رنا القيسي',      'استشارية جلدية'),
  ('b0000001-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000001', null, 'staff', 'د. سامر العبادي',    'أخصائي جلدية'),

  ('b0000002-0000-4000-8000-000000000001', 'a0000002-0000-4000-8000-000000000002', null, 'staff', 'ريم الشوابكة',       'خبيرة تجميل'),
  ('b0000002-0000-4000-8000-000000000002', 'a0000002-0000-4000-8000-000000000002', null, 'staff', 'هنا الزعبي',         'مصففة شعر'),

  ('b0000003-0000-4000-8000-000000000001', 'a0000003-0000-4000-8000-000000000003', null, 'staff', 'أبو عمر الحلاق',     'حلاق'),
  ('b0000003-0000-4000-8000-000000000002', 'a0000003-0000-4000-8000-000000000003', null, 'staff', 'محمد النعيمات',      'حلاق'),

  ('b0000004-0000-4000-8000-000000000001', 'a0000004-0000-4000-8000-000000000004', null, 'staff', 'نور الحوراني',       'أخصائية مساج'),
  ('b0000004-0000-4000-8000-000000000002', 'a0000004-0000-4000-8000-000000000004', null, 'staff', 'لينا خوري',          'معالجة سبا'),

  ('b0000005-0000-4000-8000-000000000001', 'a0000005-0000-4000-8000-000000000005', null, 'staff', 'د. خالد المومني',    'أخصائي علاج طبيعي'),
  ('b0000005-0000-4000-8000-000000000002', 'a0000005-0000-4000-8000-000000000005', null, 'staff', 'أ. دعاء بني هاني',   'أخصائية علاج طبيعي'),

  ('b0000006-0000-4000-8000-000000000001', 'a0000006-0000-4000-8000-000000000006', null, 'staff', 'لمى العتوم',         'أخصائية ليزر'),
  ('b0000006-0000-4000-8000-000000000002', 'a0000006-0000-4000-8000-000000000006', null, 'staff', 'تالا درويش',         'فنية عناية بالبشرة');


-- ---------------------------------------------------------------------
-- 4. services — four each, prices in JOD.
--
-- Deliberately NO staff_services rows. That table's eligibility test is
-- `not exists (... where ss.service_id = <service>)` — keyed on the
-- SERVICE alone — so an empty table means every staff member can perform
-- every service. Adding even one row for one service flips that service
-- to assigned-staff-only, and anyone not listed disappears from it.
-- Leaving it empty is strictly safer than a partial assignment.
--
-- sort_order is explicit because list_public_services orders by it.
-- ---------------------------------------------------------------------
insert into public.services
  (id, org_id, name, duration_minutes, buffer_minutes, price, active, sort_order)
values
  -- Dermatology
  ('c0000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', 'استشارة جلدية',            30, 10,  25.00, true, 1),
  ('c0000001-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000001', 'تنظيف بشرة عميق',          60, 10,  45.00, true, 2),
  ('c0000001-0000-4000-8000-000000000003', 'a0000001-0000-4000-8000-000000000001', 'حقن بوتوكس',               45, 10, 180.00, true, 3),
  ('c0000001-0000-4000-8000-000000000004', 'a0000001-0000-4000-8000-000000000001', 'علاج حب الشباب',           40, 10,  60.00, true, 4),

  -- Ladies salon
  ('c0000002-0000-4000-8000-000000000001', 'a0000002-0000-4000-8000-000000000002', 'قص وتصفيف شعر',            45, 10,  15.00, true, 1),
  ('c0000002-0000-4000-8000-000000000002', 'a0000002-0000-4000-8000-000000000002', 'صبغة شعر كاملة',          120, 10,  55.00, true, 2),
  ('c0000002-0000-4000-8000-000000000003', 'a0000002-0000-4000-8000-000000000002', 'مكياج سهرة',               60, 10,  40.00, true, 3),
  ('c0000002-0000-4000-8000-000000000004', 'a0000002-0000-4000-8000-000000000002', 'مانيكير وباديكير',         50, 10,  20.00, true, 4),

  -- Barbershop
  ('c0000003-0000-4000-8000-000000000001', 'a0000003-0000-4000-8000-000000000003', 'قص شعر رجالي',             30,  0,   5.00, true, 1),
  ('c0000003-0000-4000-8000-000000000002', 'a0000003-0000-4000-8000-000000000003', 'حلاقة ذقن',                20,  0,   3.00, true, 2),
  ('c0000003-0000-4000-8000-000000000003', 'a0000003-0000-4000-8000-000000000003', 'قص شعر وذقن',              45,  0,   7.00, true, 3),
  ('c0000003-0000-4000-8000-000000000004', 'a0000003-0000-4000-8000-000000000003', 'حمام مغربي للرجال',        60,  0,  18.00, true, 4),

  -- Spa
  ('c0000004-0000-4000-8000-000000000001', 'a0000004-0000-4000-8000-000000000004', 'مساج استرخائي',            60, 15,  35.00, true, 1),
  ('c0000004-0000-4000-8000-000000000002', 'a0000004-0000-4000-8000-000000000004', 'مساج بالحجر الساخن',       75, 15,  50.00, true, 2),
  ('c0000004-0000-4000-8000-000000000003', 'a0000004-0000-4000-8000-000000000004', 'حمام مغربي',               90, 15,  30.00, true, 3),
  ('c0000004-0000-4000-8000-000000000004', 'a0000004-0000-4000-8000-000000000004', 'جلسة ساونا وبخار',         45, 15,  20.00, true, 4),

  -- Physiotherapy
  ('c0000005-0000-4000-8000-000000000001', 'a0000005-0000-4000-8000-000000000005', 'تقييم وعلاج طبيعي أولي',   45, 10,  20.00, true, 1),
  ('c0000005-0000-4000-8000-000000000002', 'a0000005-0000-4000-8000-000000000005', 'جلسة علاج طبيعي',          40, 10,  15.00, true, 2),
  ('c0000005-0000-4000-8000-000000000003', 'a0000005-0000-4000-8000-000000000005', 'علاج آلام الظهر والرقبة',  45, 10,  18.00, true, 3),
  ('c0000005-0000-4000-8000-000000000004', 'a0000005-0000-4000-8000-000000000005', 'إعادة تأهيل بعد الإصابة',  60, 10,  25.00, true, 4),

  -- Laser
  ('c0000006-0000-4000-8000-000000000001', 'a0000006-0000-4000-8000-000000000006', 'ليزر جسم كامل',            90, 15, 120.00, true, 1),
  ('c0000006-0000-4000-8000-000000000002', 'a0000006-0000-4000-8000-000000000006', 'ليزر منطقة صغيرة',         30, 15,  25.00, true, 2),
  ('c0000006-0000-4000-8000-000000000003', 'a0000006-0000-4000-8000-000000000006', 'نضارة وتفتيح البشرة',      60, 15,  70.00, true, 3),
  ('c0000006-0000-4000-8000-000000000004', 'a0000006-0000-4000-8000-000000000006', 'استشارة وتحديد نوع البشرة', 20, 10,   0.00, true, 4);


-- ---------------------------------------------------------------------
-- 5. appointments — past and completed, purely so reviews can exist.
--
-- reviews.appointment_id is NOT NULL and UNIQUE, so a rating needs a
-- real appointment behind it. These are written as harmlessly as
-- possible:
--
--   * status = 'completed' and both timestamps in the past. EVERY
--     dangerous mechanism filters status = 'booked' — the no_overlap
--     exclusion constraint, the availability query, the reminder cron,
--     the per-phone rate limit, and 0026's cross-clinic customer
--     conflict guard. A 'completed' row is inert against all five, so
--     these can never block a real customer or occupy a real slot.
--   * resource_id is NEVER named: it is `generated always as
--     (coalesce(staff_id, org_id)) stored`, and listing a generated
--     column in an INSERT is a hard error that aborts the whole paste.
--   * cancel_token is left to its default. It is a capability URL — it
--     gates get_booking_by_token, cancel_booking_by_token, submit_review
--     and can_review, two of which write — so a literal token committed
--     to a repository would let anyone inject reviews into these
--     clinics' live ratings.
--   * customer_user_id stays NULL so the conflict guard's account arm
--     can never match a real person.
-- ---------------------------------------------------------------------
insert into public.appointments
  (id, org_id, service_id, staff_id, customer_name, customer_phone,
   start_at, end_at, status, created_at)
values
  ('d0000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', 'c0000001-0000-4000-8000-000000000002', 'b0000001-0000-4000-8000-000000000001', 'سارة خ.',   '0790000001', now() - interval '40 days', now() - interval '40 days' + interval '60 minutes', 'completed', now() - interval '42 days'),
  ('d0000001-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000001', 'c0000001-0000-4000-8000-000000000001', 'b0000001-0000-4000-8000-000000000002', 'أحمد ط.',   '0790000001', now() - interval '18 days', now() - interval '18 days' + interval '30 minutes', 'completed', now() - interval '20 days'),

  ('d0000002-0000-4000-8000-000000000001', 'a0000002-0000-4000-8000-000000000002', 'c0000002-0000-4000-8000-000000000002', 'b0000002-0000-4000-8000-000000000001', 'ليلى م.',   '0790000002', now() - interval '35 days', now() - interval '35 days' + interval '120 minutes', 'completed', now() - interval '37 days'),
  ('d0000002-0000-4000-8000-000000000002', 'a0000002-0000-4000-8000-000000000002', 'c0000002-0000-4000-8000-000000000003', 'b0000002-0000-4000-8000-000000000002', 'رند س.',    '0790000002', now() - interval '12 days', now() - interval '12 days' + interval '60 minutes', 'completed', now() - interval '14 days'),

  ('d0000003-0000-4000-8000-000000000001', 'a0000003-0000-4000-8000-000000000003', 'c0000003-0000-4000-8000-000000000003', 'b0000003-0000-4000-8000-000000000001', 'يوسف ع.',   '0790000003', now() - interval '30 days', now() - interval '30 days' + interval '45 minutes', 'completed', now() - interval '31 days'),
  ('d0000003-0000-4000-8000-000000000002', 'a0000003-0000-4000-8000-000000000003', 'c0000003-0000-4000-8000-000000000001', 'b0000003-0000-4000-8000-000000000002', 'مراد ح.',   '0790000003', now() - interval '9 days',  now() - interval '9 days'  + interval '30 minutes', 'completed', now() - interval '10 days'),

  ('d0000004-0000-4000-8000-000000000001', 'a0000004-0000-4000-8000-000000000004', 'c0000004-0000-4000-8000-000000000003', 'b0000004-0000-4000-8000-000000000001', 'دانا ص.',   '0790000004', now() - interval '26 days', now() - interval '26 days' + interval '90 minutes', 'completed', now() - interval '28 days'),
  ('d0000004-0000-4000-8000-000000000002', 'a0000004-0000-4000-8000-000000000004', 'c0000004-0000-4000-8000-000000000001', 'b0000004-0000-4000-8000-000000000002', 'هبة ر.',    '0790000004', now() - interval '7 days',  now() - interval '7 days'  + interval '60 minutes', 'completed', now() - interval '8 days'),

  ('d0000005-0000-4000-8000-000000000001', 'a0000005-0000-4000-8000-000000000005', 'c0000005-0000-4000-8000-000000000001', 'b0000005-0000-4000-8000-000000000001', 'عمر ب.',    '0790000005', now() - interval '21 days', now() - interval '21 days' + interval '45 minutes', 'completed', now() - interval '23 days'),
  ('d0000005-0000-4000-8000-000000000002', 'a0000005-0000-4000-8000-000000000005', 'c0000005-0000-4000-8000-000000000003', 'b0000005-0000-4000-8000-000000000002', 'رامي ف.',   '0790000005', now() - interval '5 days',  now() - interval '5 days'  + interval '45 minutes', 'completed', now() - interval '6 days'),

  ('d0000006-0000-4000-8000-000000000001', 'a0000006-0000-4000-8000-000000000006', 'c0000006-0000-4000-8000-000000000001', 'b0000006-0000-4000-8000-000000000001', 'مريم ن.',   '0790000006', now() - interval '16 days', now() - interval '16 days' + interval '90 minutes', 'completed', now() - interval '17 days'),
  ('d0000006-0000-4000-8000-000000000002', 'a0000006-0000-4000-8000-000000000006', 'c0000006-0000-4000-8000-000000000003', 'b0000006-0000-4000-8000-000000000002', 'جنى و.',    '0790000006', now() - interval '3 days',  now() - interval '3 days'  + interval '60 minutes', 'completed', now() - interval '4 days');


-- ---------------------------------------------------------------------
-- 6. reviews
--
-- Ratings are computed live inside list_directory_orgs and
-- get_org_rating_summary — there is no aggregate column and no trigger
-- anywhere in the schema, so seeded reviews cannot desynchronise
-- anything, and deleting them restores the previous averages exactly.
--
-- They are worth having: the directory orders by
-- `avg(r.rating) desc nulls last`, which puts a clinic with no reviews
-- dead last. hidden_at stays NULL — every public read filters on it.
-- ---------------------------------------------------------------------
insert into public.reviews (id, org_id, appointment_id, rating, comment, customer_name, created_at)
values
  ('e0000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', 'd0000001-0000-4000-8000-000000000001', 5, 'نتيجة ممتازة والدكتورة شرحت كل خطوة بالتفصيل. المكان نظيف والمواعيد بالوقت.', 'سارة خ.', now() - interval '39 days'),
  ('e0000001-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000001', 'd0000001-0000-4000-8000-000000000002', 4, 'استشارة مفيدة وتعامل محترم. الانتظار كان بسيط.',                            'أحمد ط.', now() - interval '17 days'),

  ('e0000002-0000-4000-8000-000000000001', 'a0000002-0000-4000-8000-000000000002', 'd0000002-0000-4000-8000-000000000001', 5, 'الصبغة طلعت زي ما تمنيت بالضبط، وأجواء الصالون مريحة جداً.',                'ليلى م.', now() - interval '34 days'),
  ('e0000002-0000-4000-8000-000000000002', 'a0000002-0000-4000-8000-000000000002', 'd0000002-0000-4000-8000-000000000002', 5, 'مكياج السهرة ثبت طول الليلة. بنصح فيهم.',                                  'رند س.',  now() - interval '11 days'),

  ('e0000003-0000-4000-8000-000000000001', 'a0000003-0000-4000-8000-000000000003', 'd0000003-0000-4000-8000-000000000001', 5, 'أسرع حلاقة وأنظف مكان بالمنطقة، والسعر ممتاز.',                            'يوسف ع.', now() - interval '29 days'),
  ('e0000003-0000-4000-8000-000000000002', 'a0000003-0000-4000-8000-000000000003', 'd0000003-0000-4000-8000-000000000002', 4, 'شغل حلو وما في انتظار لما تحجز مسبقاً.',                                   'مراد ح.', now() - interval '8 days'),

  ('e0000004-0000-4000-8000-000000000001', 'a0000004-0000-4000-8000-000000000004', 'd0000004-0000-4000-8000-000000000001', 5, 'الحمام المغربي كان تجربة ممتازة، والاهتمام بالتفاصيل واضح.',                'دانا ص.', now() - interval '25 days'),
  ('e0000004-0000-4000-8000-000000000002', 'a0000004-0000-4000-8000-000000000004', 'd0000004-0000-4000-8000-000000000002', 5, 'أفضل مساج جربته. المكان هادئ والأخصائية محترفة.',                          'هبة ر.',  now() - interval '6 days'),

  ('e0000005-0000-4000-8000-000000000001', 'a0000005-0000-4000-8000-000000000005', 'd0000005-0000-4000-8000-000000000001', 5, 'ألم الظهر تحسن كثير بعد أول جلستين، والبرنامج مدروس.',                     'عمر ب.',  now() - interval '20 days'),
  ('e0000005-0000-4000-8000-000000000002', 'a0000005-0000-4000-8000-000000000005', 'd0000005-0000-4000-8000-000000000002', 4, 'متابعة ممتازة بعد إصابة الملعب. شكراً للفريق.',                            'رامي ف.', now() - interval '4 days'),

  ('e0000006-0000-4000-8000-000000000001', 'a0000006-0000-4000-8000-000000000006', 'd0000006-0000-4000-8000-000000000001', 5, 'النتيجة واضحة من الجلسة الثانية، والفريق مرتب ومحترم جداً.',              'مريم ن.', now() - interval '15 days'),
  ('e0000006-0000-4000-8000-000000000002', 'a0000006-0000-4000-8000-000000000006', 'd0000006-0000-4000-8000-000000000002', 5, 'بشرتي صارت أنضر بكثير، وشرحولي كل إشي قبل ما نبدأ.',                      'جنى و.',  now() - interval '2 days');


commit;


-- ---------------------------------------------------------------------
-- Check what landed, and keep an eye on it afterwards.
--
-- Nobody can open a demo clinic's dashboard — these orgs have no owner
-- account by design — so if a real visitor books one, no clinic-side
-- notification goes anywhere. The customer does get a confirmation
-- email, and its subject carries the clinic name including
-- "(عرض توضيحي)". Run the second query now and then.
-- ---------------------------------------------------------------------
-- select o.slug, o.name, o.category, o.city, o.is_listed,
--        (select count(*) from public.services s   where s.org_id = o.id)    as services,
--        (select count(*) from public.memberships m where m.org_id = o.id)   as staff,
--        (select round(avg(r.rating), 1) from public.reviews r where r.org_id = o.id) as rating
-- from public.organizations o
-- where o.slug like 'demo-%'
-- order by o.slug;

-- select o.name, a.customer_name, a.customer_phone, a.start_at, a.status
-- from public.appointments a
-- join public.organizations o on o.id = a.org_id
-- where o.slug like 'demo-%' and a.created_at > now() - interval '7 days'
-- order by a.created_at desc;
