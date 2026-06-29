begin;

create table if not exists public.platform_customer_relationship_observations (
  id uuid primary key default gen_random_uuid(),
  observation_type text not null,
  source_company_id uuid null references public.companies(id) on delete set null,
  target_company_id uuid null references public.companies(id) on delete set null,
  source_customer_id uuid null references public.customers(id) on delete set null,
  target_customer_id uuid null references public.customers(id) on delete set null,
  normalized_facility_id text null,
  normalized_identity text null,
  visibility text not null default 'platform_only',
  status text not null default 'open',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid null
);

create index if not exists platform_customer_relationship_observations_facility_idx
  on public.platform_customer_relationship_observations (normalized_facility_id)
  where normalized_facility_id is not null;

create index if not exists platform_customer_relationship_observations_target_customer_idx
  on public.platform_customer_relationship_observations (target_customer_id)
  where target_customer_id is not null;

alter table public.platform_customer_relationship_observations enable row level security;

notify pgrst, 'reload schema';

commit;
