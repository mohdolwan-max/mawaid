-- Importing a clinic's existing customers (owner, 2026-10-25, item 15 of
-- the roadmap: "استيراد الزبائن الحاليين"). A clinic moving from paper, a
-- spreadsheet or another system brings its list with it.
--
-- Decided here, and why:
--   * Until now a customer existed only through a booking. An imported
--     customer is a customer file (customer_files gains name, email and
--     imported_at) and shows in the list and in their own file before
--     their first booking; booking later joins the two by the number.
--   * Nothing a clinic already has is overwritten (ENGINEERING-STANDARDS
--     §2): an existing name or email is kept, tags are merged (still at
--     most eight), a note is added as a new note. The screen shows the
--     whole list first and writes only on confirmation.
--   * Every row is checked here as well as in the browser, and every row
--     not imported comes back with its reason: never a silent drop.
--   * The owner imports (a list of people is the clinic's to decide on),
--     at most 2,000 rows at a time.
-- =====================================================================

alter table public.customer_files add column if not exists name text;
alter table public.customer_files add column if not exists email text;
alter table public.customer_files add column if not exists imported_at timestamptz;
alter table public.customer_files add column if not exists imported_by uuid references public.memberships(id) on delete set null;
alter table public.customer_files drop constraint if exists customer_files_name;
alter table public.customer_files add constraint customer_files_name check (name is null or char_length(name) between 1 and 80);
alter table public.customer_files drop constraint if exists customer_files_email;
alter table public.customer_files add constraint customer_files_email check (
  email is null or (char_length(email) <= 200 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));


-- A customer is someone the clinic booked OR imported.
create or replace function public._is_org_customer(p_org uuid, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null and p_phone is not null and (
    exists (select 1 from public.appointments a
            where a.org_id = p_org and public._norm_phone(a.customer_phone) = p_phone)
    or exists (select 1 from public.customer_files f
               where f.org_id = p_org and f.phone = p_phone and f.imported_at is not null));
$$;

revoke all on function public._is_org_customer(uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- The import. p_rows: [{name, phone, email?, notes?, tags?}]; tags as an
-- array or a comma-separated text. Returns
-- {added, updated, skipped: [{row, reason}]} (row = index in p_rows).
-- ---------------------------------------------------------------------
drop function if exists public.import_customers(jsonb);
create function public.import_customers(p_rows jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_me uuid;
  v_role text;
  v_row jsonb;
  v_i int := -1;
  v_phone text;
  v_name text;
  v_email text;
  v_notes text;
  v_tags text[];
  v_seen text[] := '{}';
  v_added int := 0;
  v_updated int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_exists boolean;
begin
  select me.org_id, me.membership_id, me.role into v_org, v_me, v_role from public._my_member() me;
  if v_org is null or not coalesce(v_role = 'owner', false) then
    raise exception 'not_authorized';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'import_bad_rows';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'import_too_many';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_row) <> 'object' then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'bad_row');
      continue;
    end if;
    v_phone := public._norm_phone(v_row ->> 'phone');
    v_name := nullif(btrim(coalesce(v_row ->> 'name', '')), '');
    v_email := nullif(lower(btrim(coalesce(v_row ->> 'email', ''))), '');
    v_notes := nullif(btrim(coalesce(v_row ->> 'notes', '')), '');
    v_tags := case
      when jsonb_typeof(v_row -> 'tags') = 'array' then array(select btrim(t) from jsonb_array_elements_text(v_row -> 'tags') t where btrim(t) <> '')
      when jsonb_typeof(v_row -> 'tags') = 'string' then array(select btrim(t) from regexp_split_to_table(v_row ->> 'tags', '[,،]') t where btrim(t) <> '')
      else '{}'::text[] end;

    if v_phone is null or not (v_phone ~ '^07[0-9]{8}$' or v_phone ~ '^01[0-9]{9}$') then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'phone');
      continue;
    end if;
    if v_name is null or char_length(v_name) > 80 then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'name');
      continue;
    end if;
    if v_email is not null and not (char_length(v_email) <= 200 and v_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'email');
      continue;
    end if;
    if v_notes is not null and char_length(v_notes) > 2000 then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'notes');
      continue;
    end if;
    if exists (select 1 from unnest(v_tags) t where char_length(t) > 30) then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'tags');
      continue;
    end if;
    if v_phone = any(v_seen) then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'duplicate');
      continue;
    end if;
    v_seen := v_seen || v_phone;

    v_exists := public._is_org_customer(v_org, v_phone)
                or exists (select 1 from public.customer_files f where f.org_id = v_org and f.phone = v_phone);

    -- Kept: what the clinic already has. Merged: the tags (first eight).
    insert into public.customer_files (org_id, phone, tags, name, email, imported_at, imported_by, updated_at)
    values (v_org, v_phone,
            (coalesce((select array_agg(t order by pos) from (
              select t, min(pos) as pos from unnest(v_tags) with ordinality u(t, pos) group by t) x), '{}'::text[]))[1:8],
            v_name, v_email, now(), v_me, now())
    on conflict (org_id, phone) do update
       set name = coalesce(customer_files.name, excluded.name),
           email = coalesce(customer_files.email, excluded.email),
           tags = ((select coalesce(array_agg(t order by ord), '{}'::text[]) from (
                     select t, min(ord) as ord from (
                       select t, o as ord from unnest(customer_files.tags) with ordinality a(t, o)
                       union all
                       select t, 100 + o from unnest(excluded.tags) with ordinality b(t, o)
                     ) z group by t
                   ) y))[1:8],
           imported_at = coalesce(customer_files.imported_at, now()),
           imported_by = coalesce(customer_files.imported_by, excluded.imported_by),
           updated_at = now();

    if v_notes is not null then
      insert into public.customer_notes (org_id, phone, body, author_membership_id)
      values (v_org, v_phone, v_notes, v_me);
    end if;

    if v_exists then
      v_updated := v_updated + 1;
    else
      v_added := v_added + 1;
    end if;
  end loop;

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;

revoke all on function public.import_customers(jsonb) from public, anon;
grant execute on function public.import_customers(jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- The list and the file (0064/0067) include customers known only from an
-- import.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_org_customers(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(phone text, name text, email text, completed integer, no_shows integer, cancelled integer, upcoming integer, first_visit timestamp with time zone, last_visit timestamp with time zone, next_visit timestamp with time zone, total_value numeric, tags text[], notes integer, packages integer, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_org uuid;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text;
begin
  select me.org_id into v_org from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  -- Digits typed in the search (any script) match inside the number.
  v_digits := nullif(regexp_replace(translate(coalesce(v_search, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g'), '');

  return query
    with per as (
      select public._norm_phone(a.customer_phone) as p,
             (array_agg(a.customer_name order by a.start_at desc))[1] as nm,
             (array_agg(a.customer_email order by a.start_at desc) filter (where a.customer_email is not null))[1] as em,
             count(*) filter (where a.status = 'completed')::int as done,
             count(*) filter (where a.status = 'no_show')::int as ns,
             count(*) filter (where a.status = 'cancelled')::int as cx,
             count(*) filter (where a.status = 'booked' and a.start_at > now())::int as up,
             min(a.start_at) filter (where a.status = 'completed') as first_at,
             max(a.start_at) filter (where a.status = 'completed') as last_at,
             min(a.start_at) filter (where a.status = 'booked' and a.start_at > now()) as next_at,
             coalesce(sum(vv.value) filter (where a.status = 'completed'), 0) as val,
             max(a.start_at) as activity
      from public.appointments a
      left join public._visit_values(v_org) vv on vv.appointment_id = a.id
      where a.org_id = v_org and a.customer_phone is not null
      group by 1
    ),
    -- 0073: customers known only from an import, not booked yet.
    imp as (
      select f.phone as p, f.name as nm, f.email as em,
             0 as done, 0 as ns, 0 as cx, 0 as up,
             null::timestamptz as first_at, null::timestamptz as last_at, null::timestamptz as next_at,
             0::numeric as val, f.imported_at as activity
      from public.customer_files f
      where f.org_id = v_org and f.imported_at is not null
        and not exists (select 1 from per where per.p = f.phone)
    ),
    allp as (select * from per union all select * from imp),
    pk as (
      select x.phone as p, count(*)::int as n
      from public._customer_packages_of(v_org, null) x
      where x.status = 'active'
      group by 1
    )
    select per.p, per.nm, per.em, per.done, per.ns, per.cx, per.up,
           per.first_at, per.last_at, per.next_at, per.val,
           coalesce(f.tags, '{}'::text[]),
           (select count(*)::int from public.customer_notes n where n.org_id = v_org and n.phone = per.p),
           coalesce(pk.n, 0),
           count(*) over ()
    from allp per
    left join public.customer_files f on f.org_id = v_org and f.phone = per.p
    left join pk on pk.p = per.p
    where per.p is not null
      and (v_search is null
           or per.nm ilike '%' || v_search || '%'
           or (v_digits is not null and per.p like '%' || v_digits || '%')
           or exists (select 1 from unnest(f.tags) t where t ilike '%' || v_search || '%'))
    order by per.activity desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

revoke all on function public.list_org_customers(text, int, int) from public, anon;
grant execute on function public.list_org_customers(text, int, int) to authenticated;

CREATE OR REPLACE FUNCTION public.get_org_customer(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_me uuid;
  v_role text;
  v_phone text := public._norm_phone(p_phone);
  v_summary jsonb;
  v_visits jsonb;
  v_notes jsonb;
  v_tags text[];
  v_packages jsonb;
  v_catalogue jsonb;
begin
  select me.org_id, me.membership_id, me.role into v_org, v_me, v_role from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  if v_phone is null then
    return null;
  end if;

  select jsonb_build_object(
           'phone', v_phone,
           'name', (array_agg(a.customer_name order by a.start_at desc))[1],
           'email', (array_agg(a.customer_email order by a.start_at desc) filter (where a.customer_email is not null))[1],
           'completed', count(*) filter (where a.status = 'completed'),
           'no_shows', count(*) filter (where a.status = 'no_show'),
           'cancelled', count(*) filter (where a.status = 'cancelled'),
           'upcoming', count(*) filter (where a.status = 'booked' and a.start_at > now()),
           'first_visit', min(a.start_at) filter (where a.status = 'completed'),
           'last_visit', max(a.start_at) filter (where a.status = 'completed'),
           'next_visit', min(a.start_at) filter (where a.status = 'booked' and a.start_at > now()),
           'total_value', coalesce(sum(vv.value) filter (where a.status = 'completed'), 0),
           'unpriced', count(*) filter (where a.status = 'completed' and vv.value is null))
    into v_summary
  from public.appointments a
  left join public._visit_values(v_org) vv on vv.appointment_id = a.id
  where a.org_id = v_org and public._norm_phone(a.customer_phone) = v_phone
  having count(*) > 0;

  if v_summary is null then
    -- 0073: a customer known only from an import: a file with no visits yet.
    select jsonb_build_object(
             'phone', v_phone, 'name', f.name, 'email', f.email,
             'completed', 0, 'no_shows', 0, 'cancelled', 0, 'upcoming', 0,
             'first_visit', null, 'last_visit', null, 'next_visit', null,
             'total_value', 0, 'unpriced', 0)
      into v_summary
    from public.customer_files f
    where f.org_id = v_org and f.phone = v_phone and f.imported_at is not null;
    if v_summary is null then
      return null;
    end if;
  end if;

  select coalesce(jsonb_agg(x order by x.start_at desc), '[]'::jsonb)
    into v_visits
  from (
    select a.id, a.start_at, a.status, a.notes, a.staff_id, a.booking_source, a.service_id,
           sv.name as service, vv.value,
           pr.customer_package_id as package_id,
           cp.name as package_name,
           coalesce(pr.auto, false) as package_auto,
           a.series_id,
           case when a.series_id is not null and a.status <> 'cancelled' then
             (select count(*) from public.appointments s
               where s.series_id = a.series_id and s.status <> 'cancelled' and s.start_at <= a.start_at) end as series_no,
           case when a.series_id is not null then
             (select count(*) from public.appointments s
               where s.series_id = a.series_id and s.status <> 'cancelled') end as series_total,
           (pr.appointment_id is not null and pr.customer_package_id is null) as package_off
    from public.appointments a
    left join public.services sv on sv.id = a.service_id
    left join public._visit_values(v_org) vv on vv.appointment_id = a.id
    left join public.package_redemptions pr on pr.appointment_id = a.id
    left join public.customer_packages cp on cp.id = pr.customer_package_id
    where a.org_id = v_org and public._norm_phone(a.customer_phone) = v_phone
    order by a.start_at desc
    limit 200
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'body', n.body, 'created_at', n.created_at,
           'author', coalesce(m.display_name, ''),
           'mine', n.author_membership_id = v_me,
           'can_delete', coalesce(n.author_membership_id = v_me, false) or v_role = 'owner')
         order by n.created_at desc), '[]'::jsonb)
    into v_notes
  from public.customer_notes n
  left join public.memberships m on m.id = n.author_membership_id
  where n.org_id = v_org and n.phone = v_phone;

  select f.tags into v_tags from public.customer_files f where f.org_id = v_org and f.phone = v_phone;

  -- Usable packages first, then by date of sale, newest first.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'name', x.name, 'service_id', x.service_id, 'service', x.service,
           'sessions_total', x.sessions_total, 'used', x.used, 'remaining', x.remaining,
           'price_paid', x.price_paid, 'sold_at', x.sold_at, 'expires_at', x.expires_at,
           'sold_by', x.sold_by, 'note', x.note, 'cancelled_at', x.cancelled_at,
           'refund_amount', x.refund_amount, 'status', x.status,
           'can_cancel', v_role = 'owner' and x.status <> 'cancelled')
         order by (x.status = 'active') desc, x.sold_at desc), '[]'::jsonb)
    into v_packages
  from public._customer_packages_of(v_org, v_phone) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.name, 'service_id', p.service_id, 'service', sv.name,
           'sessions', p.sessions, 'price', p.price, 'validity_days', p.validity_days)
         order by sv.name, p.sessions), '[]'::jsonb)
    into v_catalogue
  from public.service_packages p
  join public.services sv on sv.id = p.service_id
  where p.org_id = v_org and p.active;

  return v_summary
    || jsonb_build_object(
         'visits', v_visits, 'notes', v_notes, 'tags', to_jsonb(coalesce(v_tags, '{}'::text[])),
         'packages', v_packages, 'catalogue', v_catalogue, 'is_owner', v_role = 'owner');
end;
$function$;

revoke all on function public.get_org_customer(text) from public, anon;
grant execute on function public.get_org_customer(text) to authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select column_name from information_schema.columns where table_name = 'customer_files' and column_name in ('name','email','imported_at');  -- 3 rows
-- select has_function_privilege('anon', 'public.import_customers(jsonb)', 'execute');                                                    -- false
