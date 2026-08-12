-- Services offered by an organization (clinic/beauty center).

create table public.services (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  duration_minutes int not null check (duration_minutes > 0),
  buffer_minutes int not null default 0 check (buffer_minutes >= 0),
  price numeric(10, 2),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index services_org_id_idx on public.services (org_id);

alter table public.services enable row level security;

create policy "members can view org services"
  on public.services for select
  using (public.is_org_member(org_id));

create policy "owner can manage org services"
  on public.services for all
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));
