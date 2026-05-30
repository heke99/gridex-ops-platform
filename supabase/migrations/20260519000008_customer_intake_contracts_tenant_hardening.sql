-- Batch Customer Intake, Import, Contracts and Tenant Hardening
-- Safe/idempotent migration. It adds tenant scope and history tables without changing approved Ediel message logic.

create extension if not exists pgcrypto;

-- Add company_id where company-owned operational data is stored.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'customers',
    'customer_contacts',
    'customer_addresses',
    'customer_sites',
    'metering_points',
    'powers_of_attorney',
    'customer_authorization_documents',
    'customer_contracts',
    'customer_contract_events',
    'contract_offers',
    'supplier_switch_requests',
    'supplier_switch_events',
    'grid_owner_data_requests',
    'metering_values',
    'billing_underlays',
    'partner_exports',
    'outbound_requests',
    'audit_logs'
  ] loop
    if to_regclass('public.' || table_name) is not null then
      execute format('alter table public.%I add column if not exists company_id uuid', table_name);
      execute format('create index if not exists %I on public.%I (company_id)', table_name || '_company_id_idx', table_name);

      if to_regclass('public.companies') is not null then
        if not exists (
          select 1
          from pg_constraint
          where conname = table_name || '_company_id_fkey'
            and conrelid = ('public.' || table_name)::regclass
        ) then
          execute format(
            'alter table public.%I add constraint %I foreign key (company_id) references public.companies(id) on delete set null',
            table_name,
            table_name || '_company_id_fkey'
          );
        end if;
      end if;
    end if;
  end loop;
end $$;

-- Backfill company_id from customer-owned relations where possible.
do $$
begin
  if to_regclass('public.customer_contacts') is not null and to_regclass('public.customers') is not null then
    update public.customer_contacts cc
      set company_id = c.company_id
    from public.customers c
    where cc.customer_id = c.id
      and cc.company_id is null
      and c.company_id is not null;
  end if;

  if to_regclass('public.customer_addresses') is not null and to_regclass('public.customers') is not null then
    update public.customer_addresses ca
      set company_id = c.company_id
    from public.customers c
    where ca.customer_id = c.id
      and ca.company_id is null
      and c.company_id is not null;
  end if;

  if to_regclass('public.customer_sites') is not null and to_regclass('public.customers') is not null then
    update public.customer_sites cs
      set company_id = c.company_id
    from public.customers c
    where cs.customer_id = c.id
      and cs.company_id is null
      and c.company_id is not null;
  end if;

  if to_regclass('public.metering_points') is not null and to_regclass('public.customer_sites') is not null then
    update public.metering_points mp
      set company_id = cs.company_id
    from public.customer_sites cs
    where mp.site_id = cs.id
      and mp.company_id is null
      and cs.company_id is not null;
  end if;

  if to_regclass('public.customer_contracts') is not null and to_regclass('public.customers') is not null then
    update public.customer_contracts cc
      set company_id = c.company_id
    from public.customers c
    where cc.customer_id = c.id
      and cc.company_id is null
      and c.company_id is not null;
  end if;

  if to_regclass('public.customer_contract_events') is not null and to_regclass('public.customer_contracts') is not null then
    update public.customer_contract_events e
      set company_id = cc.company_id
    from public.customer_contracts cc
    where e.customer_contract_id = cc.id
      and e.company_id is null
      and cc.company_id is not null;
  end if;

  if to_regclass('public.powers_of_attorney') is not null and to_regclass('public.customers') is not null then
    update public.powers_of_attorney poa
      set company_id = c.company_id
    from public.customers c
    where poa.customer_id = c.id
      and poa.company_id is null
      and c.company_id is not null;
  end if;

  if to_regclass('public.supplier_switch_requests') is not null and to_regclass('public.customers') is not null then
    update public.supplier_switch_requests r
      set company_id = c.company_id
    from public.customers c
    where r.customer_id = c.id
      and r.company_id is null
      and c.company_id is not null;
  end if;

  if to_regclass('public.supplier_switch_events') is not null and to_regclass('public.supplier_switch_requests') is not null then
    update public.supplier_switch_events e
      set company_id = r.company_id
    from public.supplier_switch_requests r
    where e.switch_request_id = r.id
      and e.company_id is null
      and r.company_id is not null;
  end if;
end $$;

-- Import batch history for customer intake.
create table if not exists public.customer_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_type text not null default 'manual',
  file_name text,
  status text not null default 'previewed' check (status in ('previewed', 'imported', 'partially_imported', 'failed')),
  rows_total integer not null default 0 check (rows_total >= 0),
  rows_created integer not null default 0 check (rows_created >= 0),
  rows_failed integer not null default 0 check (rows_failed >= 0),
  issues jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  imported_at timestamptz
);

create index if not exists customer_import_batches_company_created_idx
  on public.customer_import_batches (company_id, created_at desc);

create table if not exists public.customer_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.customer_import_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  row_number integer not null,
  status text not null default 'pending' check (status in ('pending', 'created', 'skipped', 'failed')),
  customer_id uuid,
  normalized_payload jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_import_rows_batch_idx
  on public.customer_import_rows (import_batch_id, row_number);

create index if not exists customer_import_rows_company_status_idx
  on public.customer_import_rows (company_id, status);

-- Contract offer version history. This protects historical pricing decisions.
create table if not exists public.contract_offer_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contract_offer_id uuid not null references public.contract_offers(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (contract_offer_id, version_number)
);

create index if not exists contract_offer_versions_company_offer_idx
  on public.contract_offer_versions (company_id, contract_offer_id, version_number desc);

-- Optional metadata on contract offers, guarded for older databases.
do $$
begin
  if to_regclass('public.contract_offers') is not null then
    alter table public.contract_offers add column if not exists version_number integer not null default 1;
    alter table public.contract_offers add column if not exists published_at timestamptz;
    alter table public.contract_offers add column if not exists archived_at timestamptz;
    alter table public.contract_offers add column if not exists last_price_change_at timestamptz;
    create index if not exists contract_offers_company_status_idx on public.contract_offers (company_id, status, is_active);
  end if;
end $$;

-- Helpful tenant indexes for customer operations.
do $$
begin
  if to_regclass('public.customers') is not null then
    create index if not exists customers_company_status_idx on public.customers (company_id, status);
    create index if not exists customers_company_email_idx on public.customers (company_id, lower(email));
    create index if not exists customers_company_org_idx on public.customers (company_id, org_number);
    create index if not exists customers_company_personal_idx on public.customers (company_id, personal_number);
  end if;

  if to_regclass('public.customer_sites') is not null then
    create index if not exists customer_sites_company_facility_idx on public.customer_sites (company_id, facility_id);
  end if;

  if to_regclass('public.metering_points') is not null then
    create index if not exists metering_points_company_meter_point_idx on public.metering_points (company_id, meter_point_id);
  end if;

  if to_regclass('public.customer_contracts') is not null then
    create index if not exists customer_contracts_company_customer_idx on public.customer_contracts (company_id, customer_id, created_at desc);
    create index if not exists customer_contracts_company_offer_idx on public.customer_contracts (company_id, contract_offer_id);
  end if;
end $$;

alter table public.customer_import_batches enable row level security;
alter table public.customer_import_rows enable row level security;
alter table public.contract_offer_versions enable row level security;

-- Service role policy only. User-facing tenant checks are enforced in server actions.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_import_batches'
      and policyname = 'customer_import_batches_service_role_all'
  ) then
    create policy customer_import_batches_service_role_all
      on public.customer_import_batches
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_import_rows'
      and policyname = 'customer_import_rows_service_role_all'
  ) then
    create policy customer_import_rows_service_role_all
      on public.customer_import_rows
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'contract_offer_versions'
      and policyname = 'contract_offer_versions_service_role_all'
  ) then
    create policy contract_offer_versions_service_role_all
      on public.contract_offer_versions
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;
