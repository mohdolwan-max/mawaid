-- Payments carry their currency. 0047 stored amount_jod, which welds the
-- ledger to one country: the owner asked (2026-09) how this works if the
-- platform runs in more than one country, and the answer is fixed prices
-- per country in that country's currency, each payment recorded with the
-- amount AND the currency it was charged in. Done now, while the ledger
-- holds no real payments; renaming money columns later is not cheap.
--
-- Not done here, and named so nobody mistakes it for done: per-country
-- ("market") prices, cities, phone formats and a gateway profile per
-- country. Until those exist every price is in JOD, and
-- _billing_currency() is the single place that says so.
--
-- What changes:
--   * payments.amount_jod -> payments.amount, plus payments.currency.
--   * confirm_payment compares the charged amount AND currency with the
--     row; either differing becomes needs_refund, never a silent accept.
--   * Every function that returned amount_jod now returns amount and
--     currency. Their result shapes change, so each is dropped, created
--     and granted again.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The currency every price is in, until per-country prices exist.
-- ---------------------------------------------------------------------
create or replace function public._billing_currency()
returns text
language sql
immutable
set search_path = public
as $$
  select 'JOD'::text;
$$;

revoke all on function public._billing_currency() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. The table.
-- ---------------------------------------------------------------------
do $do$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'amount_jod'
  ) then
    alter table public.payments rename column amount_jod to amount;
  end if;
end
$do$;

alter table public.payments
  add column if not exists currency text not null default 'JOD';

alter table public.payments drop constraint if exists payments_currency_code;
alter table public.payments
  add constraint payments_currency_code check (currency ~ '^[A-Z]{3}$');


-- ---------------------------------------------------------------------
-- 3. What the owner sees and starts.
-- ---------------------------------------------------------------------
drop function if exists public.plan_purchase_options();
create function public.plan_purchase_options()
returns table (
  plan_id text,
  period text,
  amount numeric,
  currency text,
  starts_at timestamptz,
  ends_at timestamptz,
  credit_days int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;

  return query
    select p.id,
           per.period,
           case per.period when 'year' then p.price_year_jod else p.price_month_jod end,
           public._billing_currency(),
           w.starts_at,
           w.ends_at,
           (w.credit_seconds / 86400)::int
    from public.plans p
    cross join (values ('month', 1), ('year', 2)) as per(period, ord)
    cross join lateral public._plan_purchase_window(v_org, p.id, per.period, now()) w
    where (case per.period when 'year' then p.price_year_jod else p.price_month_jod end) > 0
    order by p.sort, per.ord;
end;
$$;

drop function if exists public.start_plan_payment(text, text, boolean);
create function public.start_plan_payment(p_plan text, p_period text, p_save_card boolean default false)
returns table (payment_id uuid, amount numeric, currency text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_amount numeric;
  v_currency text := public._billing_currency();
  v_id uuid;
begin
  v_org := public._my_owner_org();
  if v_org is null or exists (
    select 1 from public.organizations o where o.id = v_org and o.deleted_at is not null
  ) then
    raise exception 'not_authorized';
  end if;

  if p_period is null or p_period not in ('month', 'year') then
    raise exception 'payment_bad_period';
  end if;

  select case p_period when 'year' then p.price_year_jod else p.price_month_jod end
    into v_amount
  from public.plans p
  where p.id = p_plan;

  if v_amount is null or v_amount <= 0 then
    raise exception 'payment_bad_plan';
  end if;

  insert into public.payments (org_id, kind, plan_id, period, amount, currency, save_card, created_by)
  values (v_org, 'plan', p_plan, p_period, v_amount, v_currency, coalesce(p_save_card, false), auth.uid())
  returning id into v_id;

  return query select v_id, v_amount, v_currency;
end;
$$;

drop function if exists public.start_offer_payment(uuid);
create function public.start_offer_payment(p_offer_id uuid)
returns table (payment_id uuid, amount numeric, currency text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_total numeric;
  v_currency text := public._billing_currency();
  v_id uuid;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;

  -- Only an order still inside its hold (0047).
  select f.total_jod into v_total
  from public.offers f
  where f.id = p_offer_id
    and f.org_id = v_org
    and f.status = 'pending_payment'
    and f.hold_expires_at > now();

  if v_total is null then
    raise exception 'offer_not_payable';
  end if;

  insert into public.payments (org_id, kind, offer_id, amount, currency, created_by)
  values (v_org, 'offer', p_offer_id, v_total, v_currency, auth.uid())
  returning id into v_id;

  return query select v_id, v_total, v_currency;
end;
$$;

drop function if exists public.get_my_payment(uuid);
create function public.get_my_payment(p_payment_id uuid)
returns table (
  id uuid,
  kind text,
  plan_id text,
  period text,
  offer_id uuid,
  amount numeric,
  currency text,
  status text,
  outcome text,
  plan_ends_at timestamptz,
  created_at timestamptz,
  paid_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.kind, p.plan_id, p.period, p.offer_id, p.amount, p.currency, p.status,
         p.outcome, p.plan_ends_at, p.created_at, p.paid_at
  from public.payments p
  where p.id = p_payment_id
    and p.org_id = public._my_owner_org();
$$;

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
  paid_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.kind, p.plan_id, p.period, f.title, p.amount, p.currency, p.status,
         p.outcome, p.plan_ends_at, p.is_renewal, p.created_at, p.paid_at
  from public.payments p
  left join public.offers f on f.id = p.offer_id
  where p.org_id = public._my_owner_org()
    and p.status <> 'pending'
  order by p.created_at desc
  limit 100;
$$;

revoke all on function public.plan_purchase_options() from public, anon, authenticated;
grant execute on function public.plan_purchase_options() to authenticated;
revoke all on function public.start_plan_payment(text, text, boolean) from public, anon, authenticated;
grant execute on function public.start_plan_payment(text, text, boolean) to authenticated;
revoke all on function public.start_offer_payment(uuid) from public, anon, authenticated;
grant execute on function public.start_offer_payment(uuid) to authenticated;
revoke all on function public.get_my_payment(uuid) from public, anon, authenticated;
grant execute on function public.get_my_payment(uuid) to authenticated;
revoke all on function public.list_my_payments() from public, anon, authenticated;
grant execute on function public.list_my_payments() to authenticated;


-- ---------------------------------------------------------------------
-- 4. The server side (secret-gated, 0047's reasoning unchanged).
-- ---------------------------------------------------------------------
drop function if exists public.confirm_payment(text, uuid, numeric, text, text, text, text);
drop function if exists public.confirm_payment(text, uuid, numeric, text, text, text, text, text);
create function public.confirm_payment(
  p_secret text,
  p_payment_id uuid,
  p_amount numeric,
  p_currency text,
  p_provider text,
  p_provider_ref text,
  p_mandate_ref text default null,
  p_card_label text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  pay public.payments;
  v_deleted timestamptz;
  v_window record;
  v_offer_status text;
begin
  if not public._payments_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;

  select * into pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found';
  end if;

  -- Gateways retry webhooks: the second call changes nothing.
  if pay.status in ('paid', 'needs_refund') then
    return pay.status;
  end if;

  -- 19 JOD and 19 SAR are not the same payment.
  if p_amount is null or p_currency is null
     or p_amount <> pay.amount or upper(p_currency) <> pay.currency then
    update public.payments
       set status = 'needs_refund', outcome = 'amount_mismatch', paid_at = now(),
           provider = p_provider, provider_ref = p_provider_ref
     where id = pay.id;
    return 'needs_refund';
  end if;

  if pay.kind = 'plan' then
    select o.deleted_at into v_deleted
    from public.organizations o
    where o.id = pay.org_id
    for update;

    if v_deleted is not null then
      update public.payments
         set status = 'needs_refund', outcome = 'org_closed', paid_at = now(),
             provider = p_provider, provider_ref = p_provider_ref
       where id = pay.id;
      return 'needs_refund';
    end if;

    select * into v_window
    from public._plan_purchase_window(pay.org_id, pay.plan_id, pay.period, now());

    update public.organizations
       set plan = pay.plan_id,
           plan_expires_at = v_window.ends_at,
           is_trial = false
     where id = pay.org_id;

    update public.payments
       set status = 'paid', outcome = 'plan_extended', plan_ends_at = v_window.ends_at,
           paid_at = now(), provider = p_provider, provider_ref = p_provider_ref
     where id = pay.id;

    -- A saved card renews what the clinic last paid for.
    update public.billing_mandates
       set plan_id = pay.plan_id, period = pay.period, updated_at = now()
     where org_id = pay.org_id
       and (plan_id <> pay.plan_id or period <> pay.period);

    if pay.save_card and p_mandate_ref is not null then
      insert into public.billing_mandates (org_id, provider, provider_mandate_ref, plan_id, period, card_label)
      values (pay.org_id, p_provider, p_mandate_ref, pay.plan_id, pay.period, p_card_label)
      on conflict (org_id) do update
        set provider = excluded.provider,
            provider_mandate_ref = excluded.provider_mandate_ref,
            plan_id = excluded.plan_id,
            period = excluded.period,
            card_label = coalesce(excluded.card_label, billing_mandates.card_label),
            active = true,
            failures = 0,
            last_error = null,
            updated_at = now();
    end if;

    return 'paid';
  end if;

  v_offer_status := public.mark_offer_paid(pay.offer_id, p_amount, p_provider_ref);

  update public.payments
     set status = case when v_offer_status = 'paid' then 'paid' else 'needs_refund' end,
         outcome = case when v_offer_status = 'paid' then 'offer_paid' else 'offer_' || v_offer_status end,
         paid_at = now(), provider = p_provider, provider_ref = p_provider_ref
   where id = pay.id;

  return case when v_offer_status = 'paid' then 'paid' else 'needs_refund' end;
end;
$$;

drop function if exists public.claim_due_renewals(text);
create function public.claim_due_renewals(p_secret text)
returns table (
  payment_id uuid,
  org_id uuid,
  provider text,
  provider_mandate_ref text,
  plan_id text,
  period text,
  amount numeric,
  currency text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public._payments_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;

  return query
    with due as (
      select m.org_id, m.provider, m.provider_mandate_ref, m.plan_id, m.period,
             case m.period when 'year' then p.price_year_jod else p.price_month_jod end as due_amount
      from public.billing_mandates m
      join public.organizations o on o.id = m.org_id
      join public.plans p on p.id = m.plan_id
      where m.active
        and o.deleted_at is null
        and o.plan_expires_at is not null
        and o.plan_expires_at <= now() + interval '1 day'
        and not exists (
          select 1 from public.payments x
          where x.org_id = m.org_id and x.is_renewal
            and (x.status = 'pending' or x.created_at > now() - interval '20 hours')
        )
      for update of m skip locked
    ),
    created as (
      insert into public.payments (org_id, kind, plan_id, period, amount, currency, provider, save_card, is_renewal)
      select d.org_id, 'plan', d.plan_id, d.period, d.due_amount, public._billing_currency(), d.provider, true, true
      from due d
      returning id, org_id, currency
    )
    select c.id, d.org_id, d.provider, d.provider_mandate_ref, d.plan_id, d.period, d.due_amount, c.currency
    from created c
    join due d on d.org_id = c.org_id;
end;
$$;

revoke all on function public.confirm_payment(text, uuid, numeric, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_payment(text, uuid, numeric, text, text, text, text, text) to anon;
revoke all on function public.claim_due_renewals(text) from public, anon, authenticated;
grant execute on function public.claim_due_renewals(text) to anon;


-- ---------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'payments' and column_name in ('amount', 'amount_jod', 'currency')
order by column_name;                                         -- amount, currency (no amount_jod)
