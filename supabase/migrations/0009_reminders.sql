-- Appointment reminders via Web Push, ~30 minutes before start.
--
-- Delivery pipeline: a pg_cron job (scheduled in a separate one-off SQL
-- snippet — it embeds the secret, and this file lives in a public repo)
-- POSTs every 5 minutes to /api/cron/reminders on Vercel, which calls
-- claim_due_reminders() below and sends the pushes. The secret lives in
-- app_config (RLS enabled, zero policies — unreadable by anon/authed).

alter table public.appointments add column reminder_sent_at timestamptz;

-- One row per browser/device push subscription. Linked to a customer
-- account and/or a specific appointment (guests subscribe per-booking
-- via its cancel_token).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid references auth.users(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  constraint linked_to_something check (customer_user_id is not null or appointment_id is not null)
);

create index push_subscriptions_customer_idx on public.push_subscriptions (customer_user_id);
create index push_subscriptions_appointment_idx on public.push_subscriptions (appointment_id);

alter table public.push_subscriptions enable row level security;
-- No policies: all access via the RPCs below.

create table public.app_config (
  key text primary key,
  value text not null
);

alter table public.app_config enable row level security;
-- No policies: only security-definer functions read this.

-- ---------------------------------------------------------------------
-- save_push_subscription(): called from the browser after the user
-- grants notification permission. Links to the caller's customer account
-- (when they have one) and/or to a booking via its unguessable
-- cancel_token — at least one link is required, so anonymous junk rows
-- can't accumulate.
-- ---------------------------------------------------------------------
create function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_cancel_token uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_user_id uuid;
  v_appointment_id uuid;
begin
  if p_endpoint is null or trim(p_endpoint) = '' then
    raise exception 'invalid_subscription';
  end if;

  select c.user_id into v_customer_user_id
  from public.customers c where c.user_id = auth.uid();

  if p_cancel_token is not null then
    select a.id into v_appointment_id
    from public.appointments a where a.cancel_token = p_cancel_token;
  end if;

  if v_customer_user_id is null and v_appointment_id is null then
    raise exception 'not_linkable';
  end if;

  insert into public.push_subscriptions (customer_user_id, appointment_id, endpoint, p256dh, auth)
  values (v_customer_user_id, v_appointment_id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth = excluded.auth,
        customer_user_id = coalesce(excluded.customer_user_id, push_subscriptions.customer_user_id),
        appointment_id = coalesce(excluded.appointment_id, push_subscriptions.appointment_id);

  return true;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, uuid) from public;
grant execute on function public.save_push_subscription(text, text, text, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- claim_due_reminders(): atomically marks appointments starting within
-- the next 35 minutes as reminded and returns one row per (appointment ×
-- push subscription) plus the appointment fields the sender needs.
-- Secret-gated because it exposes customer contact data and marking
-- suppresses future sends.
-- ---------------------------------------------------------------------
create function public.claim_due_reminders(p_secret text)
returns table (
  appointment_id uuid,
  org_name text,
  service_name text,
  start_at timestamptz,
  timezone text,
  customer_name text,
  customer_email text,
  org_slug text,
  cancel_token uuid,
  endpoint text,
  p256dh text,
  auth text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret is distinct from (select value from public.app_config where key = 'cron_secret') then
    raise exception 'not_authorized';
  end if;

  return query
    with claimed as (
      update public.appointments a
      set reminder_sent_at = now()
      where a.status = 'booked'
        and a.reminder_sent_at is null
        and a.start_at > now()
        and a.start_at <= now() + interval '35 minutes'
      returning a.id, a.org_id, a.service_id, a.start_at, a.customer_name,
                a.customer_email, a.customer_user_id, a.cancel_token
    )
    select c.id, o.name, sv.name, c.start_at, s.timezone,
           c.customer_name, c.customer_email, o.slug, c.cancel_token,
           ps.endpoint, ps.p256dh, ps.auth
    from claimed c
    join public.organizations o on o.id = c.org_id
    join public.org_settings s on s.org_id = c.org_id
    join public.services sv on sv.id = c.service_id
    left join public.push_subscriptions ps
      on ps.appointment_id = c.id
      or (c.customer_user_id is not null and ps.customer_user_id = c.customer_user_id);
end;
$$;

revoke all on function public.claim_due_reminders(text) from public;
grant execute on function public.claim_due_reminders(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- delete_push_subscription(): the sender prunes dead endpoints (HTTP
-- 404/410 from the push service). Same secret gate.
-- ---------------------------------------------------------------------
create function public.delete_push_subscription(p_secret text, p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_secret is distinct from (select value from public.app_config where key = 'cron_secret') then
    raise exception 'not_authorized';
  end if;

  delete from public.push_subscriptions where endpoint = p_endpoint;
  return true;
end;
$$;

revoke all on function public.delete_push_subscription(text, text) from public;
grant execute on function public.delete_push_subscription(text, text) to anon, authenticated;
