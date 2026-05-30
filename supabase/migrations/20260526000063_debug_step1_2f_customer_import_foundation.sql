-- Debug Step 1+2F: customer import foundation table repair.
-- Purpose: ensure the tables used by the customer bulk/PDF import UI exist in live DB.
-- Additive/idempotent. No customer/import data is deleted.

-- The application writes customer_import_batches before customer_import_rows, so create both if missing.
create table if not exists public.customer_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_kind text,
  source_type text,
  file_name text,
  status text not null default 'previewed',
  total_rows integer not null default 0,
  rows_total integer not null default 0,
  created_rows integer not null default 0,
  rows_created integer not null default 0,
  failed_rows integer not null default 0,
  rows_failed integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  imported_at timestamptz
);

create table if not exists public.customer_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid references public.customer_import_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  row_number integer,
  status text not null default 'pending',
  normalized_payload jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  customer_id uuid references public.customers(id) on delete set null,
  error_message text,
  warnings jsonb not null default '[]'::jsonb,
  issues jsonb not null default '{}'::jsonb,
  parser_confidence integer,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  resolution text,
  possible_existing_customer_id uuid references public.customers(id) on delete set null,
  duplicate_match_payload jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Align environments that already had one of the tables with older/slimmer column sets.
alter table public.customer_import_batches add column if not exists company_id uuid;
alter table public.customer_import_batches add column if not exists source_kind text;
alter table public.customer_import_batches add column if not exists source_type text;
alter table public.customer_import_batches add column if not exists file_name text;
alter table public.customer_import_batches add column if not exists status text not null default 'previewed';
alter table public.customer_import_batches add column if not exists total_rows integer not null default 0;
alter table public.customer_import_batches add column if not exists rows_total integer not null default 0;
alter table public.customer_import_batches add column if not exists created_rows integer not null default 0;
alter table public.customer_import_batches add column if not exists rows_created integer not null default 0;
alter table public.customer_import_batches add column if not exists failed_rows integer not null default 0;
alter table public.customer_import_batches add column if not exists rows_failed integer not null default 0;
alter table public.customer_import_batches add column if not exists warnings jsonb not null default '[]'::jsonb;
alter table public.customer_import_batches add column if not exists issues jsonb not null default '[]'::jsonb;
alter table public.customer_import_batches add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.customer_import_batches add column if not exists created_by uuid;
alter table public.customer_import_batches add column if not exists created_at timestamptz not null default now();
alter table public.customer_import_batches add column if not exists updated_at timestamptz not null default now();
alter table public.customer_import_batches add column if not exists imported_at timestamptz;

alter table public.customer_import_rows add column if not exists import_batch_id uuid;
alter table public.customer_import_rows add column if not exists company_id uuid;
alter table public.customer_import_rows add column if not exists row_number integer;
alter table public.customer_import_rows add column if not exists status text not null default 'pending';
alter table public.customer_import_rows add column if not exists normalized_payload jsonb not null default '{}'::jsonb;
alter table public.customer_import_rows add column if not exists raw_payload jsonb not null default '{}'::jsonb;
alter table public.customer_import_rows add column if not exists customer_id uuid;
alter table public.customer_import_rows add column if not exists error_message text;
alter table public.customer_import_rows add column if not exists warnings jsonb not null default '[]'::jsonb;
alter table public.customer_import_rows add column if not exists issues jsonb not null default '{}'::jsonb;
alter table public.customer_import_rows add column if not exists parser_confidence integer;
alter table public.customer_import_rows add column if not exists reviewed_at timestamptz;
alter table public.customer_import_rows add column if not exists reviewed_by uuid;
alter table public.customer_import_rows add column if not exists resolution text;
alter table public.customer_import_rows add column if not exists possible_existing_customer_id uuid;
alter table public.customer_import_rows add column if not exists duplicate_match_payload jsonb not null default '[]'::jsonb;
alter table public.customer_import_rows add column if not exists created_at timestamptz not null default now();
alter table public.customer_import_rows add column if not exists updated_at timestamptz not null default now();

-- Normalize older status constraints to the values the current UI/actions use.
alter table public.customer_import_batches drop constraint if exists customer_import_batches_status_check;
alter table public.customer_import_batches
  add constraint customer_import_batches_status_check
  check (status in ('previewed', 'imported', 'partially_imported', 'completed', 'failed'));

alter table public.customer_import_rows drop constraint if exists customer_import_rows_status_check;
alter table public.customer_import_rows
  add constraint customer_import_rows_status_check
  check (status in (
    'pending',
    'ready_to_create',
    'requires_review',
    'duplicate_warning',
    'missing_fields',
    'created',
    'rejected',
    'failed',
    'skipped',
    'linked_existing_customer'
  ));

alter table public.customer_import_rows drop constraint if exists customer_import_rows_parser_confidence_check;
alter table public.customer_import_rows
  add constraint customer_import_rows_parser_confidence_check
  check (parser_confidence is null or (parser_confidence >= 0 and parser_confidence <= 100));

-- Add future-safe FK constraints without validating legacy rows.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_import_batches_company_id_fkey') then
    alter table public.customer_import_batches
      add constraint customer_import_batches_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'customer_import_batches_created_by_fkey') then
    alter table public.customer_import_batches
      add constraint customer_import_batches_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete set null not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'customer_import_rows_import_batch_id_fkey') then
    alter table public.customer_import_rows
      add constraint customer_import_rows_import_batch_id_fkey
      foreign key (import_batch_id) references public.customer_import_batches(id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'customer_import_rows_company_id_fkey') then
    alter table public.customer_import_rows
      add constraint customer_import_rows_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete cascade not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'customer_import_rows_customer_id_fkey') then
    alter table public.customer_import_rows
      add constraint customer_import_rows_customer_id_fkey
      foreign key (customer_id) references public.customers(id) on delete set null not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'customer_import_rows_reviewed_by_fkey') then
    alter table public.customer_import_rows
      add constraint customer_import_rows_reviewed_by_fkey
      foreign key (reviewed_by) references auth.users(id) on delete set null not valid;
  end if;
end $$;

create index if not exists customer_import_batches_company_created_idx
  on public.customer_import_batches(company_id, created_at desc);
create index if not exists customer_import_batches_company_status_created_idx
  on public.customer_import_batches(company_id, status, created_at desc);
create index if not exists customer_import_rows_batch_idx
  on public.customer_import_rows(import_batch_id, row_number);
create index if not exists customer_import_rows_company_status_idx
  on public.customer_import_rows(company_id, status);
create index if not exists customer_import_rows_company_status_created_idx
  on public.customer_import_rows(company_id, status, created_at desc);
create index if not exists customer_import_rows_company_batch_idx
  on public.customer_import_rows(company_id, import_batch_id, row_number);
create index if not exists customer_import_rows_customer_idx
  on public.customer_import_rows(company_id, customer_id);

alter table public.customer_import_batches enable row level security;
alter table public.customer_import_rows enable row level security;

-- Tenant-safe RLS policies. Service role is still used by server actions; authenticated tenant reads power the review UI.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_import_batches' and policyname = 'customer_import_batches_service_role_all') then
    create policy customer_import_batches_service_role_all
      on public.customer_import_batches
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_import_rows' and policyname = 'customer_import_rows_service_role_all') then
    create policy customer_import_rows_service_role_all
      on public.customer_import_rows
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_import_batches' and policyname = 'customer_import_batches_tenant_select') then
    create policy customer_import_batches_tenant_select
      on public.customer_import_batches
      for select to authenticated
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_import_rows' and policyname = 'customer_import_rows_tenant_select') then
    create policy customer_import_rows_tenant_select
      on public.customer_import_rows
      for select to authenticated
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_import_batches' and policyname = 'customer_import_batches_tenant_insert') then
    create policy customer_import_batches_tenant_insert
      on public.customer_import_batches
      for insert to authenticated
      with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_import_rows' and policyname = 'customer_import_rows_tenant_insert') then
    create policy customer_import_rows_tenant_insert
      on public.customer_import_rows
      for insert to authenticated
      with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_import_batches' and policyname = 'customer_import_batches_tenant_update') then
    create policy customer_import_batches_tenant_update
      on public.customer_import_batches
      for update to authenticated
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))
      with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_import_rows' and policyname = 'customer_import_rows_tenant_update') then
    create policy customer_import_rows_tenant_update
      on public.customer_import_rows
      for update to authenticated
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id))
      with check (public.gridex_user_is_platform_admin() or public.gridex_can_write_company(company_id));
  end if;
end $$;

-- Refresh the Step 1+2 verification view so import batches and rows are checked together.
create or replace view public.gridex_debug_step1_2_schema_alignment_v as
with required_tables(table_name) as (
  values
    ('companies'),
    ('company_memberships'),
    ('user_roles'),
    ('customers'),
    ('customer_sites'),
    ('metering_points'),
    ('customer_contracts'),
    ('customer_import_batches'),
    ('customer_import_rows'),
    ('billing_export_runs'),
    ('billing_export_run_items'),
    ('ediel_messages'),
    ('ediel_inbound_cases'),
    ('customer_portal_accounts'),
    ('customer_portal_claims')
), table_status as (
  select
    rt.table_name,
    to_regclass('public.' || rt.table_name) is not null as exists_in_db,
    coalesce(pc.relrowsecurity, false) as rls_enabled
  from required_tables rt
  left join pg_class pc on pc.oid = to_regclass('public.' || rt.table_name)
)
select
  table_name,
  exists_in_db,
  rls_enabled,
  case
    when not exists_in_db then 'missing_table'
    when not rls_enabled and table_name not in ('billing_export_runs') then 'review_rls'
    else 'ok'
  end as check_status
from table_status
order by table_name;
