-- Payments: one ledger for everything a clinic pays for (a plan period, or
-- an offer's days), whatever card gateway ends up processing it.
--
-- Owner's decisions, 2026-09: pay by card through a gateway (not chosen
-- yet: no company is registered, so the integration is built and tested
-- against a sandbox first); renewal both ways — pay each period by hand,
-- or save the card and renew automatically.
--
-- The flow, and who may do each step:
--   1. The OWNER starts a payment: start_plan_payment / start_offer_payment
--      write a pending row with the amount taken from the database, never
--      from the browser.
--   2. The app sends the clinic to the gateway's hosted page for that
--      amount. Card details never touch this app.
--   3. The gateway tells OUR SERVER the result. The server verifies the
--      gateway's signature, then calls confirm_payment / fail_payment
--      with PAYMENTS_SECRET. Those two are the only way a payment becomes
--      paid, and they are secret-gated exactly like the cron functions
--      (0032): refuse when the stored secret is missing, when none is
--      passed, or when they differ.
--   4. confirm_payment applies it: extends the plan, or pays the offer.
--      Safe to call twice (gateways retry), and money that can no longer
--      buy what it was for becomes needs_refund instead of vanishing.
--
-- Plan periods, decided here:
--   * Same plan as now: the new period starts when the current one ends,
--     trial days included, so paying early never loses days.
--   * A different plan starts now. Unused PAID days of the old plan are
--     carried over by value (days x old monthly price / new monthly
--     price), so upgrading mid-month never loses money. Trial days are
--     not carried over; they were free.
--   * A month is a calendar month, a year a calendar year.
--   The dashboard shows these dates BEFORE paying, from
--   plan_purchase_options(), the same function confirm_payment uses.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The secret the payment webhook passes. Generated once, never rotated
--    by a re-run. Printed at the end for PAYMENTS_SECRET.
-- ---------------------------------------------------------------------
insert into public.app_config (key, value)
values ('payments_secret', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create or replace function public._payments_secret_ok(p_secret text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select value into v_secret from public.app_config where key = 'payments_secret';
  return v_secret is not null and p_secret is not null and p_secret = v_secret;
end;
$$;

revoke all on function public._payments_secret_ok(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Tables. Readable and writable only through the functions below.
-- ---------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  plan_id text references public.plans(id),
  period text,
  offer_id uuid references public.offers(id) on delete cascade,
  -- JOD has three decimal places (fils).
  amount_jod numeric(10,3) not null,
  status text not null default 'pending',
  -- What paying did: 'plan_extended', 'offer_paid', or why it could not.
  outcome text,
  -- The plan end this payment produced, for the history list.
  plan_ends_at timestamptz,
  provider text,
  provider_ref text,
  -- The clinic asked to keep the card for automatic renewal.
  save_card boolean not null default false,
  is_renewal boolean not null default false,
  failure_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint payments_kind check (kind in ('plan', 'offer')),
  constraint payments_period check (period is null or period in ('month', 'year')),
  constraint payments_status check (status in ('pending', 'paid', 'failed', 'cancelled', 'needs_refund')),
  constraint payments_amount_positive check (amount_jod > 0),
  constraint payments_shape check (
    (kind = 'plan' and plan_id is not null and period is not null and offer_id is null)
    or (kind = 'offer' and offer_id is not null and plan_id is null and period is null)
  )
);

create index if not exists payments_org_created_idx on public.payments (org_id, created_at desc);
create unique index if not exists payments_provider_ref_key
  on public.payments (provider, provider_ref) where provider_ref is not null;

alter table public.payments enable row level security;
revoke all on public.payments from anon, authenticated;

-- A saved card (or gateway subscription) that renews one clinic's plan.
create table if not exists public.billing_mandates (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null,
  -- The gateway's saved-card token or subscription id. Never card data.
  provider_mandate_ref text not null,
  plan_id text not null references public.plans(id),
  period text not null,
  -- As the gateway reports it, e.g. "Visa 4242". For display only.
  card_label text,
  active boolean not null default true,
  failures int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_mandates_period check (period in ('month', 'year'))
);

alter table public.billing_mandates enable row level security;
revoke all on public.billing_mandates from anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. The plan-period rule, in one place.
-- ---------------------------------------------------------------------
drop function if exists public._plan_purchase_window(uuid, text, text, timestamptz);
create function public._plan_purchase_window(
  p_org_id uuid,
  p_plan text,
  p_period text,
  p_now timestamptz
)
returns table (starts_at timestamptz, ends_at timestamptz, credit_seconds bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_trial boolean;
  v_expires timestamptz;
  v_old_price numeric;
  v_new_price numeric;
  v_start timestamptz;
  v_credit bigint := 0;
begin
  select o.plan, o.is_trial, o.plan_expires_at
    into v_plan, v_trial, v_expires
  from public.organizations o
  where o.id = p_org_id;

  if v_plan = p_plan and v_expires is not null and v_expires > p_now then
    v_start := v_expires;
  else
    v_start := p_now;
  end if;

  if v_plan is distinct from p_plan and not v_trial
     and v_expires is not null and v_expires > p_now then
    select price_month_jod into v_old_price from public.plans where id = v_plan;
    select price_month_jod into v_new_price from public.plans where id = p_plan;
    if v_old_price > 0 and v_new_price > 0 then
      v_credit := floor(extract(epoch from (v_expires - p_now)) * v_old_price / v_new_price)::bigint;
    end if;
  end if;

  return query
    select v_start,
           v_start
             + case p_period when 'year' then interval '1 year' else interval '1 month' end
             + make_interval(secs => v_credit),
           v_credit;
end;
$$;

revoke all on function public._plan_purchase_window(uuid, text, text, timestamptz) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. What the owner sees and starts.
-- ---------------------------------------------------------------------

-- Every plan and period the clinic can buy, with its price and the exact
-- dates it would produce if paid now.
drop function if exists public.plan_purchase_options();
create function public.plan_purchase_options()
returns table (
  plan_id text,
  period text,
  amount_jod numeric,
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
returns table (payment_id uuid, amount_jod numeric)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_amount numeric;
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

  insert into public.payments (org_id, kind, plan_id, period, amount_jod, save_card, created_by)
  values (v_org, 'plan', p_plan, p_period, v_amount, coalesce(p_save_card, false), auth.uid())
  returning id into v_id;

  return query select v_id, v_amount;
end;
$$;

-- Only an order still inside its hold: once the hold lapses its days may
-- have gone, and the clinic places a new order rather than paying blind.
drop function if exists public.start_offer_payment(uuid);
create function public.start_offer_payment(p_offer_id uuid)
returns table (payment_id uuid, amount_jod numeric)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_total numeric;
  v_id uuid;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;

  select f.total_jod into v_total
  from public.offers f
  where f.id = p_offer_id
    and f.org_id = v_org
    and f.status = 'pending_payment'
    and f.hold_expires_at > now();

  if v_total is null then
    raise exception 'offer_not_payable';
  end if;

  insert into public.payments (org_id, kind, offer_id, amount_jod, created_by)
  values (v_org, 'offer', p_offer_id, v_total, auth.uid())
  returning id into v_id;

  return query select v_id, v_total;
end;
$$;

-- The return page polls this: the gateway's webhook can land a moment
-- after the clinic is sent back.
drop function if exists public.get_my_payment(uuid);
create function public.get_my_payment(p_payment_id uuid)
returns table (
  id uuid,
  kind text,
  plan_id text,
  period text,
  offer_id uuid,
  amount_jod numeric,
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
  select p.id, p.kind, p.plan_id, p.period, p.offer_id, p.amount_jod, p.status,
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
  amount_jod numeric,
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
  select p.id, p.kind, p.plan_id, p.period, f.title, p.amount_jod, p.status,
         p.outcome, p.plan_ends_at, p.is_renewal, p.created_at, p.paid_at
  from public.payments p
  left join public.offers f on f.id = p.offer_id
  where p.org_id = public._my_owner_org()
    -- Abandoned checkouts are noise in a payment history.
    and p.status <> 'pending'
  order by p.created_at desc
  limit 100;
$$;

drop function if exists public.my_billing_mandate();
create function public.my_billing_mandate()
returns table (plan_id text, period text, card_label text, active boolean, failures int, last_error text)
language sql
stable
security definer
set search_path = public
as $$
  select m.plan_id, m.period, m.card_label, m.active, m.failures, m.last_error
  from public.billing_mandates m
  where m.org_id = public._my_owner_org();
$$;

-- Turning renewal off is always allowed. Turning it back on needs a card
-- already saved by a checkout; there is nothing to renew with otherwise.
drop function if exists public.set_auto_renew(boolean);
create function public.set_auto_renew(p_active boolean)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  v_org := public._my_owner_org();
  if v_org is null then
    raise exception 'not_authorized';
  end if;

  update public.billing_mandates
     set active = coalesce(p_active, false),
         failures = case when p_active then 0 else failures end,
         updated_at = now()
   where org_id = v_org;

  if not found and p_active then
    raise exception 'no_saved_card';
  end if;
end;
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
revoke all on function public.my_billing_mandate() from public, anon, authenticated;
grant execute on function public.my_billing_mandate() to authenticated;
revoke all on function public.set_auto_renew(boolean) from public, anon, authenticated;
grant execute on function public.set_auto_renew(boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 5. The server side: secret-gated, called by the webhook and the
--    renewal job. Granted to anon because those routes run with no user
--    session (same design, and same reasoning, as 0032).
-- ---------------------------------------------------------------------
drop function if exists public.confirm_payment(text, uuid, numeric, text, text, text, text);
create function public.confirm_payment(
  p_secret text,
  p_payment_id uuid,
  p_amount_jod numeric,
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

  if p_amount_jod is null or p_amount_jod <> pay.amount_jod then
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

    -- A saved card renews what the clinic last paid for. Without this, a
    -- clinic that switched to pro by hand would be renewed on basic.
    update public.billing_mandates
       set plan_id = pay.plan_id, period = pay.period, updated_at = now()
     where org_id = pay.org_id
       and (plan_id <> pay.plan_id or period <> pay.period);

    -- The card is kept only when the clinic asked, and the gateway gave a
    -- reference to renew with.
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

  -- An offer: 0045's function decides whether its days can still run.
  v_offer_status := public.mark_offer_paid(pay.offer_id, p_amount_jod, p_provider_ref);

  update public.payments
     set status = case when v_offer_status = 'paid' then 'paid' else 'needs_refund' end,
         outcome = case when v_offer_status = 'paid' then 'offer_paid' else 'offer_' || v_offer_status end,
         paid_at = now(), provider = p_provider, provider_ref = p_provider_ref
   where id = pay.id;

  return case when v_offer_status = 'paid' then 'paid' else 'needs_refund' end;
end;
$$;

drop function if exists public.fail_payment(text, uuid, text, text);
create function public.fail_payment(p_secret text, p_payment_id uuid, p_provider text, p_reason text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status text;
  v_renewal boolean;
  v_org uuid;
begin
  if not public._payments_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;

  update public.payments
     set status = 'failed', failure_reason = left(p_reason, 300), provider = coalesce(provider, p_provider)
   where id = p_payment_id and status = 'pending'
  returning status, is_renewal, org_id into v_status, v_renewal, v_org;

  if v_status is null then
    select status into v_status from public.payments where id = p_payment_id;
    return coalesce(v_status, 'not_found');
  end if;

  -- Three failed renewals in a row stop charging the card. The plan then
  -- ends and grace applies, with the dashboard notice saying so.
  if v_renewal then
    update public.billing_mandates
       set failures = failures + 1,
           last_error = left(p_reason, 300),
           active = failures + 1 < 3,
           updated_at = now()
     where org_id = v_org;
  end if;

  return 'failed';
end;
$$;

-- The renewal job: plans ending within a day that have an active saved
-- card and no renewal already under way. Each gets a pending payment the
-- job charges with the saved card, then confirms or fails.
drop function if exists public.claim_due_renewals(text);
create function public.claim_due_renewals(p_secret text)
returns table (
  payment_id uuid,
  org_id uuid,
  provider text,
  provider_mandate_ref text,
  plan_id text,
  period text,
  amount_jod numeric
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
             case m.period when 'year' then p.price_year_jod else p.price_month_jod end as amount
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
      insert into public.payments (org_id, kind, plan_id, period, amount_jod, provider, save_card, is_renewal)
      select d.org_id, 'plan', d.plan_id, d.period, d.amount, d.provider, true, true
      from due d
      returning id, org_id
    )
    select c.id, d.org_id, d.provider, d.provider_mandate_ref, d.plan_id, d.period, d.amount
    from created c
    join due d on d.org_id = c.org_id;
end;
$$;

revoke all on function public.confirm_payment(text, uuid, numeric, text, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_payment(text, uuid, numeric, text, text, text, text) to anon;
revoke all on function public.fail_payment(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.fail_payment(text, uuid, text, text) to anon;
revoke all on function public.claim_due_renewals(text) from public, anon, authenticated;
grant execute on function public.claim_due_renewals(text) to anon;


-- ---------------------------------------------------------------------
-- Verify.
-- ---------------------------------------------------------------------
-- Without the secret, nothing can be marked paid (expect not_authorized):
--   select public.confirm_payment(null, gen_random_uuid(), 1, 'x', 'x');
--
-- The secret to put in PAYMENTS_SECRET on Vercel (type: Secret):
select value as payments_secret_copy_this
from public.app_config
where key = 'payments_secret';
