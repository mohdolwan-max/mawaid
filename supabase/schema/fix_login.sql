-- =====================================================================
-- Locked out of the new project: auth emails are not being delivered.
--
-- What was already established, so this file does not re-litigate it:
--   * /auth/v1/settings on the live project reports mailer_autoconfirm
--     = false — a confirmation email IS required before login works.
--   * POST /auth/v1/recover returns 200 with an empty body. GoTrue
--     accepted the request and believes it sent the mail, so nothing is
--     wrong with the app, the redirect URLs, or the request itself.
--     (Note: /recover returns 200 even for an address with no account —
--     that is deliberate, so the endpoint cannot be used to discover who
--     has signed up. It is not evidence the account exists.)
--
-- That leaves Supabase's BUILT-IN email service, which is documented as
-- for testing only: a couple of messages an hour, and no delivery
-- guarantee. It is not a production mailer and must be replaced before
-- real clinics sign up — see the note at the bottom.
--
-- Run SECTION 1 first and read it. It decides which fix applies.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — READ ONLY. What is actually in the new database?
-- ---------------------------------------------------------------------

select
  u.email,
  u.created_at,
  u.email_confirmed_at,
  case
    when u.email_confirmed_at is null then 'NOT CONFIRMED — this is why login fails'
    else 'confirmed'
  end as status,
  u.last_sign_in_at
from auth.users u
order by u.created_at desc;

-- Does that account already own a clinic? This is the question that
-- decides between the two fixes below: deleting a user that owns an org
-- sets memberships.user_id to NULL (0025 made the FK ON DELETE SET
-- NULL), which leaves the clinic alive but with NOBODY able to sign in
-- to it — recoverable, but only by hand.
select
  o.slug,
  o.name,
  o.is_listed,
  m.role,
  u.email as owner_email
from public.organizations o
join public.memberships m on m.org_id = o.id
left join auth.users u on u.id = m.user_id
where o.slug not like 'demo-%'
order by o.created_at desc;


-- ---------------------------------------------------------------------
-- SECTION 2 — FIX A: no clinic yet (the second query above returned
-- nothing). Simplest, and no password handling at all.
--
-- Do this in the DASHBOARD, not here:
--   1. Authentication -> Sign In / Providers -> Email
--      -> turn OFF "Confirm email" -> Save
--   2. Authentication -> Users -> delete mohdolwan@gmail.com
--   3. Sign up again on the site — you are logged straight in, and you
--      choose the password at that moment, so nothing is forgotten.
--
-- Leave "Confirm email" off only until SMTP is configured. With it off,
-- anyone can register any address without proving they own it.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- SECTION 3 — FIX B: the account already owns a clinic, so it must be
-- KEPT. Two statements, both safe to re-run.
--
-- Uncomment and run. Replace the password placeholder with one you
-- choose, then delete this file — do not commit a real password.
-- ---------------------------------------------------------------------

-- Confirm the address by hand, exactly as clicking the emailed link
-- would have. Only email_confirmed_at is set: confirmed_at is a
-- GENERATED column in GoTrue and assigning to it raises an error.
--
-- update auth.users
--    set email_confirmed_at = now()
--  where email = 'mohdolwan@gmail.com'
--    and email_confirmed_at is null;

-- Set a known password. crypt/gen_salt come from pgcrypto, which
-- Supabase installs in the extensions schema — schema-qualified here so
-- this does not depend on the editor's search_path.
--
-- update auth.users
--    set encrypted_password = extensions.crypt('PUT-A-NEW-PASSWORD-HERE', extensions.gen_salt('bf'))
--  where email = 'mohdolwan@gmail.com';


-- =====================================================================
-- BEFORE ANY REAL CLINIC SIGNS UP
--
-- Supabase's built-in mailer cannot carry this product: every clinic
-- owner needs a confirmation mail, and every one of them will eventually
-- need a password reset. Configure custom SMTP at
--   Authentication -> Emails -> SMTP Settings
-- and turn "Confirm email" back on the moment it works.
--
-- The app already sends booking confirmations through Resend
-- (RESEND_API_KEY), so the same account can serve both — Resend exposes
-- SMTP credentials alongside its API. The one prerequisite is a verified
-- sending domain: Resend cannot send from vercel.app, so this needs a
-- domain you control.
-- =====================================================================
