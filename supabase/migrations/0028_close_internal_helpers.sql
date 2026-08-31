-- The revokes in 0013, 0026 and 0027 did not actually close anything.
--
-- Every internal helper in this schema was written as:
--
--   revoke all on function public._helper(...) from public;
--
-- with a comment saying it takes no anon/authenticated grant. That
-- reasoning holds on a stock PostgreSQL, where the only privilege a new
-- function carries is EXECUTE granted to PUBLIC. It does not hold here.
-- supabase/config.toml documents this project as using the legacy
-- behaviour where entities created in `public` are auto-exposed to the
-- Data API roles — which is done by granting EXECUTE to `anon` and
-- `authenticated` DIRECTLY. Revoking from PUBLIC does not touch a grant
-- made to a named role, so all four helpers stayed callable.
--
-- Confirmed against production, as an anonymous caller holding only the
-- publishable key:
--
--   POST /rest/v1/rpc/_staff_free_for   -> 200
--   POST /rest/v1/rpc/_customer_busy    -> 200  false
--   POST /rest/v1/rpc/_norm_phone       -> 200
--   POST /rest/v1/rpc/_resource_slots   -> 200  []
--
-- Nothing else is affected: every owner-facing RPC was probed the same
-- way and each one holds its own line (is_org_owner / is_org_member /
-- auth.uid()), returning not_authorized or an empty set. The helpers are
-- the exception precisely BECAUSE they were believed unreachable, so
-- none of them checks anything.
--
-- Worst of the four is _customer_busy, added in 0027. It answers "does
-- this phone number hold a booking in this window", deliberately across
-- every clinic on the platform, and it takes p_caller_is_staff as an
-- argument — so a caller simply passes false. That is a phone-number
-- oracle: feed it Jordanian mobile numbers and it reports who has an
-- appointment somewhere and when. It was reachable for as long as 0027
-- has been applied.
--
-- _staff_free_for (0026) returns real membership ids and occupancy for
-- an arbitrary window with caller-supplied opening hours, so it bypasses
-- the min-notice and max-advance bounds the public slot RPC enforces.
--
-- _resource_slots (0013) has the same hole and has had it since 0013 was
-- applied. It is the least useful of the three to an attacker — it keeps
-- its own notice/advance bounds internally — but it is the same defect
-- and is closed here too.
--
-- _norm_phone is a pure text function and leaks nothing, but it is
-- closed for consistency: nothing outside the database should be able to
-- call it, and leaving one of the four open invites the next reader to
-- conclude the pattern is optional.
--
-- These functions keep working for the code that actually uses them.
-- get_available_slots, get_available_slots_chain and book_appointment are
-- all SECURITY DEFINER and owned by the same role, so they reach these
-- helpers through ownership, never through a grant.
-- =====================================================================

revoke all on function public._resource_slots(text, jsonb, int, int, int, int, int, date, uuid, uuid)
  from public, anon, authenticated;

revoke all on function public._staff_free_for(uuid, uuid, timestamptz, timestamptz, text, jsonb, uuid)
  from public, anon, authenticated;

revoke all on function public._customer_busy(text, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;

revoke all on function public._norm_phone(text)
  from public, anon, authenticated;


-- Stops the same thing happening to the next helper somebody adds.
-- With this in place a new function in `public` created by this role no
-- longer arrives with EXECUTE already granted to the API roles, so the
-- explicit `grant execute ... to anon, authenticated` that every public
-- RPC in this schema already carries becomes the only way in — which is
-- what the comments throughout these migrations have always claimed.
--
-- Every existing public RPC keeps its grant: default privileges apply
-- only to objects created from here on, never retroactively.
alter default privileges in schema public revoke execute on functions from anon, authenticated;


-- Verify after applying — all four must come back false:
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'execute') as anon,
--          has_function_privilege('authenticated', p.oid, 'execute') as auth
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname like '\_%'
--   order by p.proname;
