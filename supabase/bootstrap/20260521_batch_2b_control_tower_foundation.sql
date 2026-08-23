-- Source-derived Batch 2B replay foundation.
-- Restores only the historical relations consumed by the canonical Ediel control-tower projection.
-- No tenant or operational rows are seeded.

create table if not exists public.operations_automation_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_type text not null default 'batch_2b_operations',
  status text not null default 'completed' check (status in ('running', 'completed', 'completed_with_flags', 'failed')),
  customers_scanned integer not null default 0,
  tasks_created integer not null default 0,
  requests_created integer not null default 0,
  cases_created integer not null default 0,
  exports_created integer not null default 0,
  blockers_found integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists operations_automation_runs_company_created_idx
  on public.operations_automation_runs(company_id, created_at desc);

alter table public.operations_automation_runs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operations_automation_runs'
      and policyname = 'operations_automation_runs_service_role_all'
  ) then
    create policy operations_automation_runs_service_role_all
      on public.operations_automation_runs
      for all to service_role using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operations_automation_runs'
      and policyname = 'operations_automation_runs_tenant_select'
  ) then
    create policy operations_automation_runs_tenant_select
      on public.operations_automation_runs
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;

create table if not exists public.billing_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  file_name text null,
  source_type text not null default 'manual_upload',
  status text not null default 'previewed' check (status in ('previewed', 'imported', 'partially_imported', 'failed')),
  rows_total integer not null default 0,
  rows_imported integer not null default 0,
  rows_failed integer not null default 0,
  issues jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  imported_at timestamptz null
);

create table if not exists public.billing_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.billing_import_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  row_number integer not null,
  status text not null default 'pending' check (status in ('pending', 'imported', 'skipped', 'failed')),
  billing_underlay_id uuid null,
  normalized_payload jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists billing_import_batches_company_created_idx
  on public.billing_import_batches(company_id, created_at desc);
create index if not exists billing_import_rows_batch_idx
  on public.billing_import_rows(import_batch_id, row_number);
create index if not exists billing_import_rows_company_status_idx
  on public.billing_import_rows(company_id, status);

alter table public.billing_import_batches enable row level security;
alter table public.billing_import_rows enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_import_batches'
      and policyname = 'billing_import_batches_service_role_all'
  ) then
    create policy billing_import_batches_service_role_all
      on public.billing_import_batches
      for all to service_role using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_import_batches'
      and policyname = 'billing_import_batches_tenant_select'
  ) then
    create policy billing_import_batches_tenant_select
      on public.billing_import_batches
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_import_rows'
      and policyname = 'billing_import_rows_service_role_all'
  ) then
    create policy billing_import_rows_service_role_all
      on public.billing_import_rows
      for all to service_role using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'billing_import_rows'
      and policyname = 'billing_import_rows_tenant_select'
  ) then
    create policy billing_import_rows_tenant_select
      on public.billing_import_rows
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;
