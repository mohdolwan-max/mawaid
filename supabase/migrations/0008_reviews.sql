-- Reviews & ratings. One review per appointment, only after the org
-- marked it completed. Submission is cancel_token-gated (same capability-
-- URL model as guest cancel), so it works identically for guests (email
-- link) and signed-in customers (/my reuses each row's token).

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  customer_name text not null,
  created_at timestamptz not null default now()
);

create index reviews_org_created_idx on public.reviews (org_id, created_at desc);

alter table public.reviews enable row level security;

-- Org members see their own org's reviews (dashboard); the public reads
-- only through the RPCs below.
create policy "members can view org reviews"
  on public.reviews for select
  using (public.is_org_member(org_id));

-- ---------------------------------------------------------------------
-- submit_review(): token-gated, completed appointments only, once each.
-- ---------------------------------------------------------------------
create function public.submit_review(
  p_cancel_token uuid,
  p_rating int,
  p_comment text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appointment_id uuid;
  v_org_id uuid;
  v_status text;
  v_customer_name text;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating';
  end if;

  select a.id, a.org_id, a.status, a.customer_name
  into v_appointment_id, v_org_id, v_status, v_customer_name
  from public.appointments a
  where a.cancel_token = p_cancel_token;

  if v_appointment_id is null then
    raise exception 'booking_not_found';
  end if;

  if v_status <> 'completed' then
    raise exception 'not_completed';
  end if;

  if exists (select 1 from public.reviews r where r.appointment_id = v_appointment_id) then
    raise exception 'already_reviewed';
  end if;

  insert into public.reviews (org_id, appointment_id, rating, comment, customer_name)
  values (v_org_id, v_appointment_id, p_rating, nullif(trim(coalesce(p_comment, '')), ''), v_customer_name);

  return true;
end;
$$;

revoke all on function public.submit_review(uuid, int, text) from public;
grant execute on function public.submit_review(uuid, int, text) to anon, authenticated;

create function public.can_review(p_cancel_token uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    where a.cancel_token = p_cancel_token
      and a.status = 'completed'
      and not exists (select 1 from public.reviews r where r.appointment_id = a.id)
  );
$$;

revoke all on function public.can_review(uuid) from public;
grant execute on function public.can_review(uuid) to anon, authenticated;

create function public.get_org_reviews(p_org_slug text, p_limit int default 10, p_offset int default 0)
returns table (rating smallint, comment text, customer_name text, created_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select r.rating, r.comment, r.customer_name, r.created_at
  from public.reviews r
  join public.organizations o on o.id = r.org_id
  where o.slug = p_org_slug and o.deleted_at is null
  order by r.created_at desc
  limit greatest(1, least(p_limit, 50))
  offset greatest(0, p_offset);
$$;

revoke all on function public.get_org_reviews(text, int, int) from public;
grant execute on function public.get_org_reviews(text, int, int) to anon, authenticated;

create function public.get_org_rating_summary(p_org_slug text)
returns table (avg_rating numeric, review_count int)
language sql
security definer
stable
set search_path = public
as $$
  select round(avg(r.rating)::numeric, 1), count(*)::int
  from public.reviews r
  join public.organizations o on o.id = r.org_id
  where o.slug = p_org_slug and o.deleted_at is null;
$$;

revoke all on function public.get_org_rating_summary(text) from public;
grant execute on function public.get_org_rating_summary(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- list_directory_orgs(): real rating aggregates now (same signature as
-- 0006, so plain create or replace). Rated orgs sort first.
-- ---------------------------------------------------------------------
create or replace function public.list_directory_orgs(
  p_city text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 24,
  p_offset int default 0
)
returns table (
  org_id uuid,
  name text,
  slug text,
  city text,
  district text,
  category text,
  logo_url text,
  cover_image_url text,
  price_tier smallint,
  avg_rating numeric,
  review_count int
)
language sql
security definer
stable
set search_path = public
as $$
  select o.id, o.name, o.slug, o.city, o.district, o.category,
         o.logo_url, o.cover_image_url, o.price_tier,
         round(avg(r.rating)::numeric, 1), count(r.id)::int
  from public.organizations o
  left join public.reviews r on r.org_id = o.id
  where o.is_listed
    and o.deleted_at is null
    and (p_city is null or o.city = p_city)
    and (p_category is null or o.category = p_category)
    and (p_search is null or trim(p_search) = ''
         or o.name ilike '%' || trim(p_search) || '%'
         or o.district ilike '%' || trim(p_search) || '%')
  group by o.id
  order by avg(r.rating) desc nulls last, o.created_at desc
  limit greatest(1, least(p_limit, 60))
  offset greatest(0, p_offset);
$$;

-- ---------------------------------------------------------------------
-- list_my_bookings(): adds has_review (return-type change → drop first).
-- ---------------------------------------------------------------------
drop function public.list_my_bookings();

create function public.list_my_bookings()
returns table (
  id uuid,
  org_name text,
  org_slug text,
  service_name text,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  cancel_token uuid,
  has_review boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, o.name, o.slug, sv.name, a.start_at, a.end_at, a.status, a.cancel_token,
         exists (select 1 from public.reviews r where r.appointment_id = a.id)
  from public.appointments a
  join public.organizations o on o.id = a.org_id
  join public.services sv on sv.id = a.service_id
  where a.customer_user_id = auth.uid()
  order by a.start_at desc;
$$;

revoke all on function public.list_my_bookings() from public;
grant execute on function public.list_my_bookings() to authenticated;
