-- 0051 granted issue_booking_ticket to anon only.
--
-- A customer with an account (0007: /account, /my) books while signed in,
-- so PostgREST calls the function as `authenticated`, not `anon` — and the
-- call failed with a bare permission error that the booking page could only
-- show as "something went wrong". Guest booking was unaffected, which is
-- exactly the kind of gap that survives a smoke test.
--
-- The function is not weakened by the wider grant: it still refuses anyone
-- who cannot present the secret (_booking_secret_ok), so the grant decides
-- who may ASK, not who may mint.
-- =====================================================================

grant execute on function public.issue_booking_ticket(text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- Verify: both roles may call it, and neither can mint without the secret.
-- ---------------------------------------------------------------------
select has_function_privilege('anon', 'public.issue_booking_ticket(text,text,text)', 'execute') as anon_may_ask,
       has_function_privilege('authenticated', 'public.issue_booking_ticket(text,text,text)', 'execute') as customer_may_ask,
       exists (select 1 from public.app_config where key = 'booking_secret' and length(coalesce(value, '')) > 0) as secret_is_set;
