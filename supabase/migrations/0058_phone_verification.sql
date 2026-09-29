-- Phone verification at booking: a code by SMS, once per device.
--
-- Owner's decisions, 2026-09-29:
--   * the SMS the platform sends is a code at the end of booking, and it
--     is what proves the booking came from a real person with a real
--     phone. This is the step 0040 left open on purpose ("Closing that
--     needs OTP, which is the paid path"), and the one 0043's SMS
--     allowance was waiting for;
--   * a customer verifies ONCE. The app keeps that proof on the device
--     that received the code (src/lib/phoneVerify.ts explains why the
--     device and not the number);
--   * the messages cannot be switched off or capped per clinic. Every one
--     sent is recorded here against the clinic it was for, which is what
--     the plan allowance and any later billing read.
--
-- The provider (D7 Networks' Verify API) makes, sends and checks the code:
-- NO code is stored in this database. What is stored is the state around
-- it — which clinic, how many sends, how many guesses — because that is
-- where the limits have to live. Everything here is keyed on hashes the
-- server computes (salted with its secret); no phone number and no address
-- is written.
--
-- Called only by the booking Server Action, gated by the same secret as
-- the booking ticket (0051): a direct PostgREST caller can neither open a
-- verification nor spend someone else's attempts.
--
-- Nothing to configure here. Verification switches on when the app has
-- D7_API_TOKEN; until then booking works exactly as before.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Verifications in flight. Short-lived: pruned after two days.
-- ---------------------------------------------------------------------
create table if not exists public.phone_verifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone_hash text not null,
  source_hash text not null,
  -- The provider's otp_id. Replaced on every resend: D7 returns a new one.
  provider_id text,
  sends int not null default 0,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  verified_at timestamptz
);

create index if not exists phone_verifications_phone_idx
  on public.phone_verifications (phone_hash, created_at desc);
create index if not exists phone_verifications_source_idx
  on public.phone_verifications (source_hash, created_at desc);
create index if not exists phone_verifications_created_idx
  on public.phone_verifications (created_at);

alter table public.phone_verifications enable row level security;
revoke all on public.phone_verifications from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. Every SMS sent: the record the allowance and billing read. Kept.
-- ---------------------------------------------------------------------
create table if not exists public.sms_messages (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- The clinic's country when it was sent, so per-country totals never
  -- move if a clinic is moved later (0056's admin_move_org_country).
  country text not null,
  purpose text not null default 'booking_code',
  verification_id uuid,
  sent_at timestamptz not null default now(),
  constraint sms_messages_purpose check (purpose in ('booking_code'))
);

create index if not exists sms_messages_org_idx on public.sms_messages (org_id, sent_at);
create index if not exists sms_messages_country_idx on public.sms_messages (country, sent_at);

alter table public.sms_messages enable row level security;
revoke all on public.sms_messages from anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Open a verification, before anything is sent. The ceilings live here
--    because a message costs money the moment it leaves: someone looping
--    the form, or pointing it at numbers they do not own, is stopped
--    before the provider is called. An honest customer opens one, maybe
--    two when they mistype.
-- ---------------------------------------------------------------------
drop function if exists public.phone_code_open(text, text, text, text);
create function public.phone_code_open(
  p_secret text,
  p_org_slug text,
  p_phone_hash text,
  p_source_hash text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_src_hour int;
  v_src_day int;
  v_ph_hour int;
  v_ph_day int;
  v_id uuid;
begin
  if not public._booking_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;
  if p_phone_hash is null or length(p_phone_hash) < 16
     or p_source_hash is null or length(p_source_hash) < 16 then
    raise exception 'bad_request';
  end if;

  select o.id into v_org_id
  from public.organizations o
  where o.slug = p_org_slug
    and not public._org_closed(o.deleted_at, o.plan_expires_at);
  if v_org_id is null then
    raise exception 'org_not_found';
  end if;

  -- Serialised per source and per number, always in that order, so a
  -- burst cannot slip past a count that has not committed yet (0051).
  perform pg_advisory_xact_lock(hashtext('phone_code:src:' || p_source_hash));
  perform pg_advisory_xact_lock(hashtext('phone_code:ph:' || p_phone_hash));

  select count(*) filter (where v.created_at > now() - interval '1 hour'),
         count(*) filter (where v.created_at > now() - interval '1 day')
    into v_src_hour, v_src_day
  from public.phone_verifications v
  where v.source_hash = p_source_hash;

  select count(*) filter (where v.created_at > now() - interval '1 hour'),
         count(*) filter (where v.created_at > now() - interval '1 day')
    into v_ph_hour, v_ph_day
  from public.phone_verifications v
  where v.phone_hash = p_phone_hash;

  -- A connection: a family or a clinic's waiting-room wifi books a few
  -- numbers; a script books dozens. A number: one person, a typo or two.
  if v_src_hour >= 5 or v_src_day >= 12 or v_ph_hour >= 3 or v_ph_day >= 5 then
    raise exception 'rate_limited';
  end if;

  insert into public.phone_verifications (org_id, phone_hash, source_hash)
  values (v_org_id, p_phone_hash, p_source_hash)
  returning id into v_id;

  if random() < 0.05 then
    delete from public.phone_verifications where created_at < now() - interval '2 days';
  end if;

  return v_id;
end;
$$;

revoke all on function public.phone_code_open(text, text, text, text) from public, anon, authenticated;
grant execute on function public.phone_code_open(text, text, text, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. A message went out (first send or resend): remember the provider's
--    id and record the SMS against the clinic.
-- ---------------------------------------------------------------------
drop function if exists public.phone_code_sent(text, uuid, text);
create function public.phone_code_sent(p_secret text, p_id uuid, p_provider_id text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_country text;
begin
  if not public._booking_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;
  if p_provider_id is null or length(p_provider_id) = 0 then
    raise exception 'bad_request';
  end if;

  update public.phone_verifications v
     set provider_id = p_provider_id,
         sends = v.sends + 1,
         last_sent_at = now()
   where v.id = p_id
     and v.verified_at is null
  returning v.org_id into v_org;

  if v_org is null then
    raise exception 'code_not_found';
  end if;

  select o.country into v_country from public.organizations o where o.id = v_org;

  insert into public.sms_messages (org_id, country, purpose, verification_id)
  values (v_org, coalesce(v_country, 'JO'), 'booking_code', p_id);
end;
$$;

revoke all on function public.phone_code_sent(text, uuid, text) from public, anon, authenticated;
grant execute on function public.phone_code_sent(text, uuid, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 5. May this code be sent again? Returns the provider id to resend.
--    Two resends at most, a minute apart — the same numbers the provider
--    is told (src/lib/d7.ts), held here too so they cannot be bypassed.
-- ---------------------------------------------------------------------
drop function if exists public.phone_code_resend_check(text, uuid, text);
create function public.phone_code_resend_check(p_secret text, p_id uuid, p_phone_hash text)
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

  if v.id is null or v.phone_hash <> p_phone_hash or v.provider_id is null then
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

revoke all on function public.phone_code_resend_check(text, uuid, text) from public, anon, authenticated;
grant execute on function public.phone_code_resend_check(text, uuid, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 6. Spend one guess. Returns the provider id to check the code against.
--    Five guesses per code: a six-digit code then holds against guessing
--    (5 in a million), and the provider never sees a brute-force run.
-- ---------------------------------------------------------------------
drop function if exists public.phone_code_attempt(text, uuid, text, text);
create function public.phone_code_attempt(p_secret text, p_id uuid, p_phone_hash text, p_org_slug text)
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
  if v.id is null or v.phone_hash <> p_phone_hash or v_slug is distinct from p_org_slug
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

revoke all on function public.phone_code_attempt(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.phone_code_attempt(text, uuid, text, text) to anon, authenticated;


drop function if exists public.phone_code_verified(text, uuid);
create function public.phone_code_verified(p_secret text, p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public._booking_secret_ok(p_secret) then
    raise exception 'not_authorized';
  end if;
  update public.phone_verifications
     set verified_at = now()
   where id = p_id
     and verified_at is null;
end;
$$;

revoke all on function public.phone_code_verified(text, uuid) from public, anon, authenticated;
grant execute on function public.phone_code_verified(text, uuid) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 7. The clinic's messages this month, on its own calendar, beside the
--    plan's allowance (0043). Read by the plan card.
-- ---------------------------------------------------------------------
drop function if exists public.my_sms_usage();
create function public.my_sms_usage()
returns table (used_this_month int)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid;
  v_tz text;
begin
  select m.org_id into v_org
  from public.memberships m
  where m.user_id = auth.uid()
  limit 1;

  if v_org is null then
    raise exception 'not_authorized';
  end if;

  -- The clinic's own clock (org_settings), else its country's (0056).
  select coalesce(
           (select s.timezone from public.org_settings s where s.org_id = v_org),
           (select m.timezone from public.organizations o join public.markets m on m.code = o.country where o.id = v_org),
           'Asia/Amman'
         )
    into v_tz;

  return query
    select count(*)::int
    from public.sms_messages s
    where s.org_id = v_org
      and s.sent_at >= (date_trunc('month', now() at time zone v_tz) at time zone v_tz);
end;
$$;

revoke all on function public.my_sms_usage() from public, anon, authenticated;
grant execute on function public.my_sms_usage() to authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select has_function_privilege('anon', 'public.phone_code_open(text,text,text,text)', 'execute');   -- true
-- select public.phone_code_open('wrong', 'x', repeat('a',22), repeat('b',22));                      -- not_authorized
-- select has_table_privilege('anon', 'public.sms_messages', 'select');                              -- false
