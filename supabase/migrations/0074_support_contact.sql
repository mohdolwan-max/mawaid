-- The support channel (owner, 2026-10-25, item 14 of the roadmap: "قناة دعم
-- واتساب ودليل استخدام"). A clinic reaches the platform from its dashboard.
--
-- Decided here, and why:
--   * The support WhatsApp number and email are the platform admin's to
--     set, from the admin panel, whenever they like: the number was not
--     chosen when this was built, and a number written into the code
--     would need a deploy to change. Until one is set, the clinic sees the
--     email only (support@maw3ed.me, a real inbox).
--   * Stored in app_config beside the secrets, so it is read only through
--     support_contact(), which returns exactly these two values and
--     nothing else from that table.
-- =====================================================================

insert into public.app_config (key, value) values ('support_email', 'support@maw3ed.me')
on conflict (key) do nothing;

drop function if exists public.support_contact();
create function public.support_contact()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'whatsapp', (select c.value from public.app_config c where c.key = 'support_whatsapp'),
    'email', (select c.value from public.app_config c where c.key = 'support_email'));
$$;

revoke all on function public.support_contact() from public, anon, authenticated;
grant execute on function public.support_contact() to anon, authenticated;

-- The admin sets them. The number is kept as international digits
-- (9627…); an empty value removes it.
drop function if exists public.admin_set_support_contact(text, text);
create function public.admin_set_support_contact(p_whatsapp text, p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if not public._is_platform_admin() then
    raise exception 'not_authorized';
  end if;
  -- 00962… typed with the international prefix: drop the 00.
  if v_digits like '00%' then
    v_digits := substr(v_digits, 3);
  end if;
  if v_digits <> '' and v_digits !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'support_whatsapp';
  end if;
  if v_email is not null and not (char_length(v_email) <= 200 and v_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'support_email';
  end if;

  if v_digits = '' then
    delete from public.app_config where key = 'support_whatsapp';
  else
    insert into public.app_config (key, value) values ('support_whatsapp', v_digits)
    on conflict (key) do update set value = excluded.value;
  end if;
  if v_email is null then
    delete from public.app_config where key = 'support_email';
  else
    insert into public.app_config (key, value) values ('support_email', v_email)
    on conflict (key) do update set value = excluded.value;
  end if;
  return public.support_contact();
end;
$$;

revoke all on function public.admin_set_support_contact(text, text) from public, anon;
grant execute on function public.admin_set_support_contact(text, text) to authenticated;


-- The Help page lives at /help, beside clinic pages at /<slug>.
insert into public.reserved_slugs (slug) values ('help') on conflict do nothing;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select public.support_contact();   -- {"email": "support@maw3ed.me", "whatsapp": null}
-- No clinic may already hold the name (expect 0 rows):
-- select slug from public.organizations where slug = 'help';
