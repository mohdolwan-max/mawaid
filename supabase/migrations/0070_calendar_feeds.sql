-- Calendar links (owner, 2026-10-25, item 12 of the roadmap: "مزامنة تقويم
-- Google"). A specialist sees their appointments in Google Calendar, the
-- iPhone calendar or Outlook, kept up to date by the calendar itself.
--
-- Decided here, and why:
--   * A subscription link (iCalendar), not a Google sign-in. Two-way sync
--     needs a Google Cloud app that Google verifies before strangers may
--     use it; a link works today in every calendar, with no approval and
--     no password of ours anywhere. The cost, said on screen: calendars
--     fetch it on their own schedule (Google every few hours), so it is a
--     view of the diary, not the place to check a booking made a minute
--     ago. Two-way sync stays open for when the owner has the Google app.
--   * One link per member for their own appointments; the owner may also
--     take one for the whole clinic. The link IS the key: long, random,
--     shown only to its holder, and replaceable at once ("reset"), which
--     kills the old one.
--   * It carries what a diary needs: the service, the customer's name and
--     number, the specialist, the note. Cancelled visits are sent as
--     cancelled so they disappear from the calendar instead of lingering.
--     From 30 days back to a year ahead.
-- =====================================================================

create table if not exists public.calendar_feeds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- The member whose appointments it shows; NULL = the whole clinic.
  membership_id uuid,
  -- Who holds the link (the owner, for a whole-clinic feed).
  holder_membership_id uuid not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint calendar_feeds_member_same_org foreign key (membership_id, org_id)
    references public.memberships (id, org_id) on delete cascade,
  constraint calendar_feeds_holder_same_org foreign key (holder_membership_id, org_id)
    references public.memberships (id, org_id) on delete cascade,
  constraint calendar_feeds_token check (token ~ '^[0-9a-f]{64}$')
);

create unique index if not exists calendar_feeds_one_live
  on public.calendar_feeds (holder_membership_id, coalesce(membership_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where revoked_at is null;

alter table public.calendar_feeds enable row level security;
revoke all on public.calendar_feeds from anon, authenticated;


-- ---------------------------------------------------------------------
-- 1. The member's link: the live one, or a new one. p_scope 'me' (own
--    appointments) or 'clinic' (owner only). p_reset revokes the old one
--    and issues another.
-- ---------------------------------------------------------------------
drop function if exists public.my_calendar_feed(text, boolean);
create function public.my_calendar_feed(p_scope text, p_reset boolean default false)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_me uuid;
  v_role text;
  v_target uuid;
  v_token text;
begin
  select me.org_id, me.membership_id, me.role into v_org, v_me, v_role from public._my_member() me;
  if v_org is null then
    raise exception 'not_authorized';
  end if;
  if p_scope = 'me' then
    v_target := v_me;
  elsif p_scope = 'clinic' and coalesce(v_role = 'owner', false) then
    v_target := null;
  else
    raise exception 'not_authorized';
  end if;

  if coalesce(p_reset, false) then
    update public.calendar_feeds f
       set revoked_at = now()
     where f.holder_membership_id = v_me and f.revoked_at is null
       and f.membership_id is not distinct from v_target;
  else
    select f.token into v_token
    from public.calendar_feeds f
    where f.holder_membership_id = v_me and f.revoked_at is null
      and f.membership_id is not distinct from v_target;
    if v_token is not null then
      return v_token;
    end if;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.calendar_feeds (org_id, membership_id, holder_membership_id, token)
  values (v_org, v_target, v_me, v_token);
  return v_token;
end;
$$;

revoke all on function public.my_calendar_feed(text, boolean) from public, anon;
grant execute on function public.my_calendar_feed(text, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 2. The feed itself, by its token (the calendar app has no session).
--    A revoked token, an unknown one, or one whose holder has left the
--    clinic returns nothing.
-- ---------------------------------------------------------------------
drop function if exists public.calendar_feed_events(text);
create function public.calendar_feed_events(p_token text)
returns table (
  id uuid,
  start_at timestamptz,
  end_at timestamptz,
  status text,
  service text,
  customer_name text,
  customer_phone text,
  staff text,
  notes text,
  updated_at timestamptz,
  org_name text,
  org_address text,
  feed_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  f public.calendar_feeds%rowtype;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return;
  end if;
  select * into f from public.calendar_feeds c where c.token = p_token and c.revoked_at is null;
  if f.id is null then
    return;
  end if;
  -- The holder must still belong to the clinic.
  if not exists (select 1 from public.memberships m where m.id = f.holder_membership_id and m.org_id = f.org_id) then
    return;
  end if;
  return query
    select a.id, a.start_at, a.end_at, a.status, sv.name, a.customer_name, a.customer_phone,
           coalesce(m.display_name, ''), a.notes, a.updated_at, o.name, o.address,
           case when f.membership_id is null then o.name
                else coalesce((select mm.display_name from public.memberships mm where mm.id = f.membership_id), o.name) end
    from public.appointments a
    join public.organizations o on o.id = a.org_id
    left join public.services sv on sv.id = a.service_id
    left join public.memberships m on m.id = a.staff_id
    where a.org_id = f.org_id
      and (f.membership_id is null or a.staff_id = f.membership_id)
      and a.status in ('booked', 'completed', 'cancelled')
      and a.start_at >= now() - interval '30 days'
      and a.start_at < now() + interval '365 days'
    order by a.start_at
    limit 2000;
end;
$$;

revoke all on function public.calendar_feed_events(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_events(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- Verify after applying:
-- ---------------------------------------------------------------------
-- select has_table_privilege('authenticated', 'public.calendar_feeds', 'select');   -- false
-- select count(*) from public.calendar_feed_events(repeat('0', 64));                -- 0
