-- The invoice a clinic receives (owner, 2026-09-28: "اشوف نموذج الفاتورة
-- الي بتصدر"). 0050 numbers and taxes every sale; this adds the document:
-- one function that returns everything an invoice prints, for the clinic
-- that paid it and for the platform admin, and nobody else.
--
-- Decided here, and why:
--   * The invoice reads the payment's own snapshot (amount, net, tax, rate,
--     buyer name, item) and its registration. So that a reprint months
--     later shows the seller exactly as the original did, a registration's
--     legal name and tax number now lock once it has issued an invoice, as
--     its currency and prefix already did (0050). A new legal name is a new
--     registration; the old invoices keep the old one.
--   * The clinic's payment list carries the invoice number, so the billing
--     page links only payments that have an invoice.
--
-- Not done here (phase 2, before Saudi Arabia opens): the ZATCA fields,
-- meaning the buyer's VAT number and national address, the seller's CR
-- number, and the QR code.
-- =====================================================================


-- /invoice/<id> is a page of its own (0057), so a clinic may not take
-- "invoice" as its address: its page would never be reached.
insert into public.reserved_slugs (slug) values ('invoice') on conflict do nothing;


-- ---------------------------------------------------------------------
-- 1. One invoice.
-- ---------------------------------------------------------------------
drop function if exists public.get_invoice(uuid);
create function public.get_invoice(p_payment_id uuid)
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
  if not (public._is_platform_admin() or (p.org_id is not null and p.org_id = public._my_owner_org())) then
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

revoke all on function public.get_invoice(uuid) from public, anon, authenticated;
grant execute on function public.get_invoice(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 2. The clinic's payment list (0048), with the invoice number.
-- ---------------------------------------------------------------------
drop function if exists public.list_my_payments();
create function public.list_my_payments()
returns table (
  id uuid,
  kind text,
  plan_id text,
  period text,
  offer_title text,
  amount numeric,
  currency text,
  status text,
  outcome text,
  plan_ends_at timestamptz,
  is_renewal boolean,
  created_at timestamptz,
  paid_at timestamptz,
  invoice_no text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.kind, p.plan_id, p.period, coalesce(f.title, p.item_title), p.amount, p.currency, p.status,
         p.outcome, p.plan_ends_at, p.is_renewal, p.created_at, p.paid_at, p.invoice_no
  from public.payments p
  left join public.offers f on f.id = p.offer_id
  where p.org_id = public._my_owner_org()
    and p.status <> 'pending'
  order by p.created_at desc
  limit 100;
$$;

revoke all on function public.list_my_payments() from public, anon, authenticated;
grant execute on function public.list_my_payments() to authenticated;


-- ---------------------------------------------------------------------
-- 3. A registration that has issued invoices keeps its identity.
--    0056's function; only the lock grows.
-- ---------------------------------------------------------------------
drop function if exists public.admin_save_tax_registration(uuid, text, text, text, text, text, numeric, text, text, boolean, text);
create function public.admin_save_tax_registration(
  p_id uuid,
  p_country text,
  p_currency text,
  p_legal_name text,
  p_tax_number text,
  p_address text,
  p_tax_rate numeric,
  p_timezone text,
  p_invoice_prefix text,
  p_active boolean,
  p_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  prev public.tax_registrations;
  saved public.tax_registrations;
  v_constraint text;
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'admin_reason_required';
  end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names z where z.name = p_timezone) then
    raise exception 'tax_bad_timezone';
  end if;
  if not exists (select 1 from public.markets m where m.code = v_country and m.currency = v_currency) then
    raise exception 'tax_country_currency';
  end if;

  if p_id is not null then
    select * into prev from public.tax_registrations where id = p_id for update;
    if not found then
      raise exception 'tax_not_found';
    end if;
    -- Everything an issued invoice prints about the seller stays as it was
    -- printed. The address may still change: a move is a real event, and
    -- the invoice is not the legal record of where the seller sat.
    if exists (select 1 from public.payments p where p.tax_registration_id = p_id)
       and (prev.currency <> v_currency
            or prev.country <> v_country
            or prev.invoice_prefix <> upper(btrim(coalesce(p_invoice_prefix, '')))
            or prev.legal_name <> btrim(coalesce(p_legal_name, ''))
            or prev.tax_number <> btrim(coalesce(p_tax_number, ''))) then
      raise exception 'tax_locked_fields';
    end if;
  end if;

  begin
    if p_id is null then
      insert into public.tax_registrations
        (country, currency, legal_name, tax_number, address, tax_rate, timezone, invoice_prefix, active)
      values
        (v_country, v_currency, btrim(p_legal_name), btrim(p_tax_number),
         nullif(btrim(coalesce(p_address, '')), ''), p_tax_rate, p_timezone,
         upper(btrim(p_invoice_prefix)), coalesce(p_active, true))
      returning * into saved;
    else
      update public.tax_registrations
         set country = v_country,
             currency = v_currency,
             legal_name = btrim(p_legal_name),
             tax_number = btrim(p_tax_number),
             address = nullif(btrim(coalesce(p_address, '')), ''),
             tax_rate = p_tax_rate,
             timezone = p_timezone,
             invoice_prefix = upper(btrim(p_invoice_prefix)),
             active = coalesce(p_active, true),
             updated_at = now()
       where id = p_id
      returning * into saved;
    end if;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'tax_registrations_prefix_key' then
        raise exception 'tax_prefix_taken';
      end if;
      raise exception 'tax_country_taken';
    when check_violation or not_null_violation then
      raise exception 'tax_bad_input';
  end;

  perform public._admin_log(
    case when p_id is null then 'tax_registration_create' else 'tax_registration_update' end,
    null, saved.id,
    jsonb_build_object('previous', case when p_id is null then null else to_jsonb(prev) end,
                       'saved', to_jsonb(saved), 'reason', btrim(p_reason)));

  return saved.id;
end;
$$;

revoke all on function public.admin_save_tax_registration(uuid, text, text, text, text, text, numeric, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_save_tax_registration(uuid, text, text, text, text, text, numeric, text, text, boolean, text) to authenticated;


-- ---------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------
-- An invoiced payment you own returns a document; anyone else gets null:
--   select public.get_invoice('<payment id>');
select count(*) as invoiced_payments from public.payments where invoice_no is not null;
