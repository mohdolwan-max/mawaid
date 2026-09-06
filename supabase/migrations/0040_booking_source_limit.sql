-- Stop bulk fake bookings without asking honest customers for anything.
--
-- The existing limit (0027) counts six bookings an hour PER PHONE, which
-- one changed digit resets — so filling a clinic's whole week costs a
-- prankster nothing. This adds a second ceiling keyed on the REQUEST's
-- source instead of on anything the person types, so varying the phone
-- no longer helps. A real customer books once or twice; the abuse case
-- needs dozens, and that is where this bites.
--
-- Owner's constraint, and it is the right one: no friction on the honest
-- path. Nobody is asked to verify anything, and a booking still lands in
-- one step.
--
-- PRIVACY: the app sends a salted SHA-256 of the client address and this
-- table stores ONLY that. There is no address here to leak, and nothing
-- stored can be turned back into one.
--
-- Honest limit of this layer, so nobody mistakes it for more: it lives
-- in the booking Server Action, so it covers everyone using the site.
-- Somebody calling book_appointment straight through the API skips it
-- and is bounded by the per-phone limit (0027) and the phone shape rule
-- (0039) instead. Closing that needs OTP, which is the paid path.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. The log. One row per accepted booking attempt, hash only.
-- ---------------------------------------------------------------------
create table if not exists public.booking_source_log (
  id bigserial primary key,
  source_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists booking_source_log_lookup
  on public.booking_source_log (source_hash, created_at desc);

-- No policies, and no table grants: only the SECURITY DEFINER function
-- below may read or write this. Nothing in the app queries it directly.
alter table public.booking_source_log enable row level security;
revoke all on public.booking_source_log from anon, authenticated;
revoke all on sequence public.booking_source_log_id_seq from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. The gate. Raises 'rate_limited' — the same error the per-phone
--    limit already raises, so the app's existing message covers both.
-- ---------------------------------------------------------------------
create or replace function public.check_booking_source(p_source_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour int;
  v_day  int;
begin
  -- No usable source (a proxy stripped the header, or local dev). FAIL
  -- OPEN: a booking that cannot be attributed must never be refused —
  -- one misconfigured header would otherwise close the whole product.
  if p_source_hash is null or length(p_source_hash) < 32 then
    return;
  end if;

  select count(*) filter (where created_at > now() - interval '1 hour'),
         count(*) filter (where created_at > now() - interval '1 day')
    into v_hour, v_day
  from public.booking_source_log
  where source_hash = p_source_hash
    and created_at > now() - interval '1 day';

  -- Generous on purpose: a family booking for four from one home
  -- connection in an evening must pass. Shared office or café wi-fi is
  -- the one honest case that can reach a ceiling — hence a "try again
  -- shortly" message rather than a refusal, and an hourly window that
  -- clears itself.
  if v_hour >= 3 or v_day >= 8 then
    raise exception 'rate_limited';
  end if;

  insert into public.booking_source_log (source_hash) values (p_source_hash);

  -- Opportunistic prune instead of another scheduled job: nothing here
  -- is useful past a week, and at 1-in-20 calls the table stays small
  -- without paying for a scan on every booking.
  if random() < 0.05 then
    delete from public.booking_source_log
    where created_at < now() - interval '7 days';
  end if;
end;
$$;

revoke all on function public.check_booking_source(text) from public, anon, authenticated;
grant execute on function public.check_booking_source(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying — four calls with the same hash: the first
-- three pass, the fourth raises rate_limited.
-- ---------------------------------------------------------------------
-- select public.check_booking_source(repeat('a', 64));  -- 1 ok
-- select public.check_booking_source(repeat('a', 64));  -- 2 ok
-- select public.check_booking_source(repeat('a', 64));  -- 3 ok
-- select public.check_booking_source(repeat('a', 64));  -- 4 -> rate_limited
-- select public.check_booking_source(null);             -- always ok (fail open)
-- delete from public.booking_source_log where source_hash = repeat('a', 64);
