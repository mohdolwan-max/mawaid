-- Two authorisation checks that a NULL walked through, found by the
-- isolation audit of 2026-09-29 (two clinics, every exposed function and
-- table tried by the other clinic's owner, staff, customer and an
-- anonymous visitor).
--
-- The shape of the bug, in both: `if not (A or B = x) then refuse`. When x
-- is NULL, `B = x` is NULL, `false or NULL` is NULL, `not NULL` is NULL,
-- and IF treats NULL as "do not refuse". The fix is coalesce(..., false):
-- anything that is not a definite yes is a no.
--
--   1. update_staff_profile: for an anonymous caller auth.uid() is NULL, so
--      ANYONE could rewrite the name, phone, photo, bio and title of any
--      staff member who has a login, or of the clinic owner, in any clinic.
--      Membership ids are public (the booking page picks a doctor by them).
--      Reached live: the function was open to anon since 0022 recreated it
--      without repeating 0013's revoke.
--   2. get_invoice: for any signed-in user who owns no clinic (a customer,
--      a staff member) _my_owner_org() is NULL, so the invoice was returned:
--      another clinic's invoice number, amount, gateway reference and name.
--      Needs the payment's id (a random uuid, not exposed), so hard to
--      reach, but a clinic's staff could read their own clinic's invoices,
--      which 0057 meant for the owner and the admin only.
--
-- Also hardened, not exploitable (secret-gated, only our server calls them):
-- phone_code_attempt / phone_code_resend_check compared hashes with <>.
--
-- And defence in depth: the owner/staff/customer functions below were
-- executable by anon. Each refuses anon correctly today (the audit tried
-- them all), but none has any use without a session, so anon loses them.
-- is_org_member / is_org_owner stay: row policies call them for every role.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. update_staff_profile
-- ---------------------------------------------------------------------
create or replace function public.update_staff_profile(
  p_membership_id uuid,
  p_display_name text default null,
  p_bio text default null,
  p_photo_url text default null,
  p_phone text default null,
  p_title text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_user_id uuid;
begin
  select org_id, user_id into v_org_id, v_user_id
  from public.memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'staff_not_found';
  end if;
  -- Owner of the clinic, or the staff member editing their own profile.
  -- coalesce: an anonymous caller (auth.uid() NULL) is a no, not a pass.
  if not coalesce(public.is_org_owner(v_org_id) or v_user_id = auth.uid(), false) then
    raise exception 'not_authorized';
  end if;
  update public.memberships
  set display_name = coalesce(nullif(trim(coalesce(p_display_name, '')), ''), display_name),
      bio = coalesce(p_bio, bio),
      photo_url = coalesce(p_photo_url, photo_url),
      phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
      title = coalesce(nullif(trim(coalesce(p_title, '')), ''), title)
  where id = p_membership_id;
  return true;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. get_invoice (0057), the guard only; the document is unchanged.
-- ---------------------------------------------------------------------
create or replace function public.get_invoice(p_payment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p public.payments;
  r public.tax_registrations;
  o public.organizations;
  f public.offers;
begin
  select * into p from public.payments where id = p_payment_id;
  -- Not found, not invoiced, or not the caller's: the same answer, so the
  -- function says nothing about payments the caller may not see.
  if not found or p.invoice_no is null then
    return null;
  end if;
  -- The admin, or the owner of the clinic that paid. coalesce: a caller who
  -- owns no clinic makes the comparison NULL, which must read as no.
  if not coalesce(public._is_platform_admin() or p.org_id = public._my_owner_org(), false) then
    return null;
  end if;

  select * into r from public.tax_registrations where id = p.tax_registration_id;
  if p.org_id is not null then
    select * into o from public.organizations where id = p.org_id;
  end if;
  if p.offer_id is not null then
    select * into f from public.offers where id = p.offer_id;
  end if;

  return jsonb_build_object(
    'id', p.id,
    'invoice_no', p.invoice_no,
    'invoiced_at', p.invoiced_at,
    'paid_at', p.paid_at,
    'status', p.status,
    'refunded_at', p.refunded_at,
    'country', p.country,
    'currency', p.currency,
    'amount', p.amount,
    'net_amount', p.net_amount,
    'tax_amount', p.tax_amount,
    'tax_rate', p.tax_rate,
    'kind', p.kind,
    'plan_id', p.plan_id,
    'period', p.period,
    'plan_ends_at', p.plan_ends_at,
    'is_renewal', p.is_renewal,
    'item_title', coalesce(f.title, p.item_title),
    'offer_start', f.start_date,
    'offer_end', f.end_date,
    'provider', p.provider,
    'provider_ref', p.provider_ref,
    'buyer', jsonb_build_object(
      'name', coalesce(p.buyer_name, o.name),
      'city', o.city,
      'country', coalesce(o.country, p.country),
      'slug', o.slug),
    'seller', jsonb_build_object(
      'legal_name', r.legal_name,
      'tax_number', r.tax_number,
      'address', r.address,
      'country', r.country,
      'timezone', r.timezone));
end;
$$;


-- ---------------------------------------------------------------------
-- 3. The booking-code functions (0058): NULL-proof comparisons.
-- ---------------------------------------------------------------------
create or replace function public.phone_code_resend_check(p_secret text, p_id uuid, p_phone_hash text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v public.phone_verifications%rowtype;
begin
  if not public._booking_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;

  select * into v
  from public.phone_verifications pv
  where pv.id = p_id
  for update;

  if v.id is null or v.phone_hash is distinct from p_phone_hash or v.provider_id is null then
    raise exception 'code_not_found';
  end if;
  if v.verified_at is not null then
    raise exception 'code_used';
  end if;
  if v.created_at < now() - interval '30 minutes' then
    raise exception 'code_expired';
  end if;
  if v.sends >= 3 then
    raise exception 'resend_limit';
  end if;
  if v.last_sent_at > now() - interval '60 seconds' then
    raise exception 'resend_too_soon';
  end if;

  return v.provider_id;
end;
$$;

create or replace function public.phone_code_attempt(p_secret text, p_id uuid, p_phone_hash text, p_org_slug text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v public.phone_verifications%rowtype;
  v_slug text;
begin
  if not public._booking_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;

  select * into v
  from public.phone_verifications pv
  where pv.id = p_id
  for update;

  select o.slug into v_slug from public.organizations o where o.id = v.org_id;

  -- The code proves THIS number for THIS clinic's booking; a code for one
  -- number cannot be replayed to book with another.
  if v.id is null or v.phone_hash is distinct from p_phone_hash or v_slug is distinct from p_org_slug
     or v.provider_id is null or v.last_sent_at is null then
    raise exception 'code_not_found';
  end if;
  -- Already verified (a double tap): the provider answers ALREADY_VERIFIED.
  if v.verified_at is not null then
    return v.provider_id;
  end if;
  if v.last_sent_at < now() - interval '10 minutes' then
    raise exception 'code_expired';
  end if;
  if v.attempts >= 5 then
    raise exception 'code_too_many';
  end if;

  update public.phone_verifications set attempts = attempts + 1 where id = v.id;
  return v.provider_id;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. Signed-in functions: no longer callable without a session.
--    PUBLIC is revoked too, because anon inherits whatever PUBLIC has.
-- ---------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.update_staff_profile(uuid, text, text, text, text, text)',
    'public.update_staff_schedule(uuid, jsonb)',
    'public.remove_staff_time_off(uuid)',
    'public.list_staff_time_off(uuid)',
    'public.hide_review(uuid)',
    'public.unhide_review(uuid)',
    'public.close_organization()',
    'public.remove_staff_member(uuid)',
    'public.invite_staff(uuid, text, text, uuid)',
    'public.add_staff_member(text, text, text)',
    'public.mark_notifications_read()',
    'public.request_account_deletion()',
    'public.cancel_account_deletion()',
    'public.list_my_bookings()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- get_invoice keeps 0057's grants (authenticated only); restated so this
-- file stands on its own.
revoke all on function public.get_invoice(uuid) from public, anon;
grant execute on function public.get_invoice(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying (SQL Editor):
-- ---------------------------------------------------------------------
-- select has_function_privilege('anon', 'public.update_staff_profile(uuid,text,text,text,text,text)', 'execute');  -- false
-- select has_function_privilege('authenticated', 'public.update_staff_profile(uuid,text,text,text,text,text)', 'execute');  -- true
