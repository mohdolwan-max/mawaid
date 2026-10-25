-- The customer file: who a clinic's customers are, what they have had, and
-- the clinic's own notes about them (owner, 2026-10-25, item 4 of the
-- roadmap: "ملف الزبون لدى العيادة").
--
-- Decided here, and why:
--   * A customer is a normalised phone number at one clinic. Most bookings
--     are guests with no account, and the phone is the only identity every
--     booking carries; 079… and +962 79… are one person (_norm_phone, 0027).
--   * Everything is per clinic. A file, its notes and its tags exist only
--     inside the clinic that wrote them: no clinic ever sees another's,
--     and the customer never sees them.
--   * The figures are computed from appointments on every read, never
--     stored: a stored "visits: 7" goes stale the moment a status changes.
--   * Any member of the clinic may read files and write notes and tags (a
--     receptionist and a doctor both need the history). A note may be
--     deleted by its author or by the owner.
--   * Read and written only through the functions below; the tables have
--     no grants and no policies.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------
create table if not exists public.customer_files (
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone text not null,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (org_id, phone),
  constraint customer_files_phone check (phone ~ '^0[0-9]{9,10}$'),
  constraint customer_files_tags check (cardinality(tags) <= 8)
);

create table if not exists public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone text not null,
  body text not null,
  author_membership_id uuid references public.memberships(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint customer_notes_phone check (phone ~ '^0[0-9]{9,10}$'),
  constraint customer_notes_body check (char_length(btrim(body)) between 1 and 2000)
);

create index if not exists customer_notes_lookup on public.customer_notes (org_id, phone, created_at desc);

alter table public.customer_files enable row level security;
alter table public.customer_notes enable row level security;
revoke all on public.customer_files from anon, authenticated;
revoke all on public.customer_notes from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2. The caller's clinic and membership, for any member (owner or staff).
--    NULL for anyone who belongs to no clinic: every caller of these
--    helpers treats NULL as "refuse" (0059's lesson, never a pass).
-- ---------------------------------------------------------------------
create or replace function public._my_member()
returns table (org_id uuid, membership_id uuid, role text)
language sql
stable
security definer
set search_path = public
as $$
  select m.org_id, m.id, m.role
  from public.memberships m
  where m.user_id = auth.uid()
  order by (m.role = 'owner') desc, m.created_at
  limit 1;
$$;

revoke all on function public._my_member() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. The clinic's customers, newest activity first, with search.
-- ---------------------------------------------------------------------
drop function if exists public.list_org_customers(text, int, int);
create function public.list_org_customers(p_search text default null, p_limit int default 50, p_offset int default 0)
returns table (
  phone text,
  name text,
  email text,
  completed int,
  no_shows int,
  cancelled int,
  upcoming int,
  first_visit timestamptz,
  last_visit timestamptz,
  next_visit timestamptz,
  total_value numeric,
  tags text[],
  notes int,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
             coalesce(sum(sv.price) filter (where a.status = 'completed'), 0) as val,
             max(a.start_at) as activity
      from public.appointments a
      left join public.services sv on sv.id = a.service_id
      where a.org_id = v_org and a.customer_phone is not null
      group by 1
    )
    select per.p, per.nm, per.em, per.done, per.ns, per.cx, per.up,
           per.first_at, per.last_at, per.next_at, per.val,
           coalesce(f.tags, '{}'::text[]),
           (select count(*)::int from public.customer_notes n where n.org_id = v_org and n.phone = per.p),
           count(*) over ()
    from per
    left join public.customer_files f on f.org_id = v_org and f.phone = per.p
    where per.p is not null
      and (v_search is null
           or per.nm ilike '%' || v_search || '%'
           or (v_digits is not null and per.p like '%' || v_digits || '%')
           or exists (select 1 from unnest(f.tags) t where t ilike '%' || v_search || '%'))
    order by per.activity desc
    limit greatest(1, least(coalesce(p_limit, 50), 100))
    offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.list_org_customers(text, int, int) from public, anon;
grant execute on function public.list_org_customers(text, int, int) to authenticated;


-- ---------------------------------------------------------------------
-- 4. One customer's file. NULL when this clinic has never booked them.
-- ---------------------------------------------------------------------
drop function if exists public.get_org_customer(text);
create function public.get_org_customer(p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_me uuid;
  v_role text;
  v_phone text := public._norm_phone(p_phone);
  v_summary jsonb;
  v_visits jsonb;
  v_notes jsonb;
  v_tags text[];
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
           'total_value', coalesce(sum(sv.price) filter (where a.status = 'completed'), 0),
           'unpriced', count(*) filter (where a.status = 'completed' and sv.price is null))
    into v_summary
  from public.appointments a
  left join public.services sv on sv.id = a.service_id
  where a.org_id = v_org and public._norm_phone(a.customer_phone) = v_phone
  having count(*) > 0;

  if v_summary is null then
    return null;
  end if;

  select coalesce(jsonb_agg(x order by x.start_at desc), '[]'::jsonb)
    into v_visits
  from (
    select a.id, a.start_at, a.status, a.notes, a.staff_id, a.booking_source,
           sv.name as service, sv.price
    from public.appointments a
    left join public.services sv on sv.id = a.service_id
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

  return v_summary
    || jsonb_build_object('visits', v_visits, 'notes', v_notes, 'tags', to_jsonb(coalesce(v_tags, '{}'::text[])));
end;
$$;

revoke all on function public.get_org_customer(text) from public, anon;
grant execute on function public.get_org_customer(text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Notes and tags. Only for a customer this clinic has actually booked:
--    a file cannot be opened on any number someone types.
-- ---------------------------------------------------------------------
create or replace function public._is_org_customer(p_org uuid, p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null and p_phone is not null and exists (
    select 1 from public.appointments a
    where a.org_id = p_org and public._norm_phone(a.customer_phone) = p_phone);
$$;

revoke all on function public._is_org_customer(uuid, text) from public, anon, authenticated;

drop function if exists public.add_customer_note(text, text);
create function public.add_customer_note(p_phone text, p_body text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_me uuid;
  v_phone text := public._norm_phone(p_phone);
  v_id uuid;
begin
  select me.org_id, me.membership_id into v_org, v_me from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  if not public._is_org_customer(v_org, v_phone) then
    raise exception 'customer_not_found';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'note_length';
  end if;
  insert into public.customer_notes (org_id, phone, body, author_membership_id)
  values (v_org, v_phone, btrim(p_body), v_me)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_customer_note(text, text) from public, anon;
grant execute on function public.add_customer_note(text, text) to authenticated;

drop function if exists public.delete_customer_note(uuid);
create function public.delete_customer_note(p_note_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_me uuid;
  v_role text;
  v_count int;
begin
  select me.org_id, me.membership_id, me.role into v_org, v_me, v_role from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  delete from public.customer_notes n
   where n.id = p_note_id
     and n.org_id = v_org
     and (v_role = 'owner' or n.author_membership_id = v_me);
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'note_not_found';
  end if;
  return true;
end;
$$;

revoke all on function public.delete_customer_note(uuid) from public, anon;
grant execute on function public.delete_customer_note(uuid) to authenticated;

drop function if exists public.set_customer_tags(text, text[]);
create function public.set_customer_tags(p_phone text, p_tags text[])
returns text[]
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_phone text := public._norm_phone(p_phone);
  v_tags text[];
begin
  select me.org_id into v_org from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  if not public._is_org_customer(v_org, v_phone) then
    raise exception 'customer_not_found';
  end if;
  -- Trimmed, empty ones dropped, duplicates removed, order kept.
  select coalesce(array_agg(t order by first_pos), '{}')
    into v_tags
  from (
    select btrim(t) as t, min(pos) as first_pos
    from unnest(coalesce(p_tags, '{}'::text[])) with ordinality as u(t, pos)
    where btrim(t) <> ''
    group by btrim(t)
  ) x;
  if cardinality(v_tags) > 8 or exists (select 1 from unnest(v_tags) t where char_length(t) > 30) then
    raise exception 'tags_invalid';
  end if;
  insert into public.customer_files (org_id, phone, tags, updated_at)
  values (v_org, v_phone, v_tags, now())
  on conflict (org_id, phone) do update set tags = excluded.tags, updated_at = now();
  return v_tags;
end;
$$;

revoke all on function public.set_customer_tags(text, text[]) from public, anon;
grant execute on function public.set_customer_tags(text, text[]) to authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select has_function_privilege('anon', 'public.list_org_customers(text,int,int)', 'execute');     -- false
-- select has_table_privilege('authenticated', 'public.customer_notes', 'select');                  -- false
