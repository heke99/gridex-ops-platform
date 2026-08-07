-- GRIDEX-AUD-003 derived bootstrap: restore the historical grid-owner resolver request foundation.
-- Source: supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql
-- The source migration is immutable and checksum-pinned in scripts/migration-history-manifest.json.
-- Keep this artifact limited to the three directly connected tenant/process relations required by
-- later tracked grid-owner communication migrations; platform geometry/import objects remain out of scope.

create table if not exists public.grid_owner_contact_routes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  grid_owner_id uuid,
  grid_area_code text,
  request_type text not null default 'facility_lookup',
  channel text not null default 'email' check (channel in ('email','ediel','portal','manual')),
  target_email text,
  ediel_message_family text,
  ediel_message_code text,
  template_id text not null default 'facility_lookup.default',
  requires_poa boolean not null default true,
  auto_send_allowed boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive','needs_review')),
  priority integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists grid_owner_contact_routes_company_idx
  on public.grid_owner_contact_routes (company_id);

create index if not exists grid_owner_contact_routes_lookup_idx
  on public.grid_owner_contact_routes (
    coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    grid_owner_id,
    grid_area_code,
    request_type,
    status,
    priority
  );

create table if not exists public.customer_site_resolution (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  customer_application_id uuid,
  grid_owner_id uuid,
  grid_area_code text,
  grid_area_name text,
  grid_owner_name text,
  price_area text check (price_area is null or price_area in ('SE1','SE2','SE3','SE4')),
  resolution_status text not null default 'postal_suggested' check (resolution_status in (
    'postal_suggested','address_resolved','grid_area_resolved','grid_area_master_validated',
    'facility_data_requested','facility_data_received','facility_verified','needs_review','failed'
  )),
  confidence numeric(5,4) not null default 0,
  source_chain jsonb not null default '[]'::jsonb,
  input_snapshot jsonb not null default '{}'::jsonb,
  result_snapshot jsonb not null default '{}'::jsonb,
  automation_allowed boolean not null default false,
  next_required_action text,
  facility_data_verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_site_resolution_company_idx
  on public.customer_site_resolution (company_id, customer_id, customer_site_id, created_at desc);

create index if not exists customer_site_resolution_status_idx
  on public.customer_site_resolution (company_id, resolution_status, created_at desc);

create index if not exists customer_site_resolution_grid_idx
  on public.customer_site_resolution (grid_area_code, price_area);

create table if not exists public.grid_owner_information_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  customer_application_id uuid,
  resolution_id uuid references public.customer_site_resolution(id) on delete set null,
  grid_owner_id uuid,
  grid_area_code text,
  price_area text check (price_area is null or price_area in ('SE1','SE2','SE3','SE4')),
  request_type text not null default 'facility_lookup' check (request_type in ('facility_lookup','metering_point_lookup','grid_area_confirmation','metering_values_request','switch_prerequisite_check')),
  status text not null default 'draft' check (status in ('draft','ready_to_send','sent','waiting_response','received','completed','failed','needs_review')),
  channel text not null default 'manual' check (channel in ('email','ediel','portal','manual')),
  template_id text,
  contact_route_id uuid references public.grid_owner_contact_routes(id) on delete set null,
  requested_fields text[] not null default array['facility_id','metering_point_id','grid_area_code','price_area']::text[],
  facility_id text,
  metering_point_id text,
  received_payload jsonb not null default '{}'::jsonb,
  requires_poa boolean not null default true,
  poa_id uuid,
  sent_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  assigned_to uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists grid_owner_information_requests_company_idx
  on public.grid_owner_information_requests (company_id, status, created_at desc);

create index if not exists grid_owner_information_requests_customer_idx
  on public.grid_owner_information_requests (company_id, customer_id, customer_site_id);

create unique index if not exists grid_owner_information_requests_open_uidx
  on public.grid_owner_information_requests (company_id, customer_site_id, request_type)
  where status in ('draft','ready_to_send','sent','waiting_response','needs_review');
