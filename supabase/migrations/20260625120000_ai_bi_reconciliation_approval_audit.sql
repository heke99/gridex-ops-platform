-- Batch 8: AI/BI list import is reconciliation, not automatic masterdata overwrite.
-- Creates the reconciliation foundation tables if they are missing, then adds
-- admin approval, audit and retention/GDPR metadata.
--
-- Idempotent, additive and tenant-safe.
-- No destructive operations.
-- AI/BI import must never auto-overwrite customer_sites, metering_points,
-- contracts or supplier_switch_requests.

create extension if not exists pgcrypto;

create table if not exists public.ai_list_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  list_type text not null check (list_type in ('AI', 'BI')),
  filename text,
  grid_owner_id uuid,
  status text not null default 'parsed',
  row_count integer not null default 0,
  discrepancy_count integer not null default 0,
  raw_payload text,
  metadata jsonb not null default '{}'::jsonb,
  retention_until date,
  gdpr_basis text,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_list_import_rows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  import_id uuid not null references public.ai_list_imports(id) on delete cascade,
  row_number integer not null,
  raw_columns jsonb not null default '{}'::jsonb,
  metering_point_external_id text,
  matched_metering_point_id uuid references public.metering_points(id) on delete set null,
  matched_customer_id uuid references public.customers(id) on delete set null,
  matched_customer_site_id uuid references public.customer_sites(id) on delete set null,
  match_status text not null default 'unmatched',
  discrepancy_reasons text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create table if not exists public.ai_list_discrepancies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  import_id uuid not null references public.ai_list_imports(id) on delete cascade,
  import_row_id uuid not null references public.ai_list_import_rows(id) on delete cascade,
  discrepancy_type text not null,
  severity text not null default 'warning',
  current_values jsonb not null default '{}'::jsonb,
  imported_values jsonb not null default '{}'::jsonb,
  proposed_values jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  applied_by uuid,
  applied_at timestamptz,
  resolution text,
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table if exists public.ai_list_imports
  add column if not exists retention_until date,
  add column if not exists gdpr_basis text,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz;

alter table if exists public.ai_list_discrepancies
  add column if not exists resolution text,
  add column if not exists resolution_note text,
  add column if not exists resolved_by uuid,
  add column if not exists resolved_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'ai_list_discrepancies'
      and constraint_name = 'ai_list_discrepancies_resolution_chk'
  ) then
    alter table public.ai_list_discrepancies
      add constraint ai_list_discrepancies_resolution_chk
      check (
        resolution is null
        or resolution in ('accepted', 'rejected', 'accepted_manual_apply')
      );
  end if;
end $$;

create index if not exists idx_ai_list_imports_company_status
  on public.ai_list_imports(company_id, status, created_at desc);

create index if not exists idx_ai_list_import_rows_import
  on public.ai_list_import_rows(company_id, import_id, row_number);

create index if not exists idx_ai_list_import_rows_metering_point
  on public.ai_list_import_rows(company_id, metering_point_external_id);

create index if not exists idx_ai_list_discrepancies_company_status
  on public.ai_list_discrepancies(company_id, status, discrepancy_type, created_at desc);

alter table public.ai_list_imports enable row level security;
alter table public.ai_list_import_rows enable row level security;
alter table public.ai_list_discrepancies enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_list_imports'
      and policyname = 'gridcore_ai_list_imports_tenant_read'
  ) then
    create policy gridcore_ai_list_imports_tenant_read
      on public.ai_list_imports
      for select
      using (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_read_company(company_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_list_imports'
      and policyname = 'gridcore_ai_list_imports_tenant_write'
  ) then
    create policy gridcore_ai_list_imports_tenant_write
      on public.ai_list_imports
      for all
      using (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_write_company(company_id)
      )
      with check (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_write_company(company_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_list_import_rows'
      and policyname = 'gridcore_ai_list_import_rows_tenant_read'
  ) then
    create policy gridcore_ai_list_import_rows_tenant_read
      on public.ai_list_import_rows
      for select
      using (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_read_company(company_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_list_import_rows'
      and policyname = 'gridcore_ai_list_import_rows_tenant_write'
  ) then
    create policy gridcore_ai_list_import_rows_tenant_write
      on public.ai_list_import_rows
      for all
      using (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_write_company(company_id)
      )
      with check (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_write_company(company_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_list_discrepancies'
      and policyname = 'gridcore_ai_list_discrepancies_tenant_read'
  ) then
    create policy gridcore_ai_list_discrepancies_tenant_read
      on public.ai_list_discrepancies
      for select
      using (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_read_company(company_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_list_discrepancies'
      and policyname = 'gridcore_ai_list_discrepancies_tenant_write'
  ) then
    create policy gridcore_ai_list_discrepancies_tenant_write
      on public.ai_list_discrepancies
      for all
      using (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_write_company(company_id)
      )
      with check (
        public.gridex_user_is_platform_admin()
        or public.gridex_can_write_company(company_id)
      );
  end if;
end $$;

comment on table public.ai_list_imports is
  'AI/BI reconciliation import runs. Reconciliation-only; must not auto-overwrite masterdata.';

comment on table public.ai_list_import_rows is
  'Parsed AI/BI import rows matched against Gridex customer/site/metering point data.';

comment on table public.ai_list_discrepancies is
  'AI/BI reconciliation discrepancies requiring admin review or deterministic audited approval.';

comment on column public.ai_list_discrepancies.resolution is
  'Admin decision: accepted, rejected, or accepted_manual_apply. AI/BI import never auto-overwrites masterdata.';

comment on column public.ai_list_discrepancies.resolution_note is
  'Admin note explaining the reconciliation decision.';

comment on column public.ai_list_discrepancies.resolved_by is
  'User who resolved the AI/BI reconciliation discrepancy.';

comment on column public.ai_list_discrepancies.resolved_at is
  'Timestamp when the AI/BI reconciliation discrepancy was resolved.';

comment on column public.ai_list_imports.retention_until is
  'Retention boundary for imported AI/BI raw payload (GDPR).';

comment on column public.ai_list_imports.gdpr_basis is
  'Documented GDPR/legal basis for retaining the imported reconciliation data.';

comment on column public.ai_list_imports.approved_by is
  'User who approved the AI/BI reconciliation import or safe application.';

comment on column public.ai_list_imports.approved_at is
  'Timestamp when the AI/BI reconciliation import or safe application was approved.';