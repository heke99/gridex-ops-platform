-- Canonical anläggningsadress: provenance, conflict handling and resolver-safe state.
-- Tenant/customer sources may submit candidates. Only superadmin/grid-owner responses may verify.

alter table if exists public.customer_sites
  add column if not exists apartment_number text,
  add column if not exists address_normalized text,
  add column if not exists address_hash text,
  add column if not exists address_source text,
  add column if not exists address_source_reference text,
  add column if not exists address_received_at timestamptz,
  add column if not exists address_verified_at timestamptz,
  add column if not exists address_verified_by uuid references auth.users(id) on delete set null,
  add column if not exists address_verification_method text,
  add column if not exists address_confidence numeric(5,4),
  add column if not exists address_status text not null default 'incomplete';

create index if not exists customer_sites_address_hash_idx
  on public.customer_sites(company_id, customer_id, address_hash)
  where address_hash is not null;

create table if not exists public.customer_site_address_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_site_id uuid not null references public.customer_sites(id) on delete cascade,
  address_hash text,
  source text not null,
  source_reference text,
  actor_user_id uuid references auth.users(id) on delete set null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_site_address_history_lookup_idx
  on public.customer_site_address_history(company_id, customer_site_id, created_at desc);

create table if not exists public.customer_site_address_conflicts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  customer_site_id uuid not null references public.customer_sites(id) on delete cascade,
  status text not null default 'open',
  existing_address jsonb not null default '{}'::jsonb,
  candidate_address jsonb not null default '{}'::jsonb,
  candidate_source text not null,
  candidate_source_reference text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_site_address_conflicts_status_check check (status in ('open','resolved','dismissed'))
);

create index if not exists customer_site_address_conflicts_open_idx
  on public.customer_site_address_conflicts(company_id, customer_site_id, created_at desc)
  where status = 'open';

-- Backfill safe canonical metadata only. Existing address data remains unverified until resolver/nätägare confirms it.
update public.customer_sites
set address_status = case
  when coalesce(trim(street), '') <> ''
   and regexp_replace(coalesce(postal_code, ''), '\\D', '', 'g') ~ '^\\d{5}$'
   and coalesce(trim(city), '') <> ''
  then 'candidate'
  else 'incomplete'
end,
address_source = coalesce(address_source, 'import'),
address_received_at = coalesce(address_received_at, updated_at, created_at, now())
where address_status is null or address_source is null or address_received_at is null;

alter table public.customer_site_address_history enable row level security;
alter table public.customer_site_address_conflicts enable row level security;

alter table if exists public.customer_portal_completions
  add column if not exists result_payload jsonb null;
