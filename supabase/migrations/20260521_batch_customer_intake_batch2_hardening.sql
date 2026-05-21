-- Batch Kundintag 1-rest + Batch 2: intake statuses, import review queue, PDF confidence, fullmakt and contract start-date hardening.
-- Additive/idempotent. Does not change Ediel payload generators or approved AGT/TGT facit.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.customers') is not null then
    alter table public.customers add column if not exists intake_status text not null default 'draft';
    alter table public.customers add column if not exists intake_missing_fields jsonb not null default '[]'::jsonb;
    alter table public.customers add column if not exists intake_warnings jsonb not null default '[]'::jsonb;
    alter table public.customers add column if not exists intake_quality_score integer null;

    alter table public.customers drop constraint if exists customers_intake_status_check;
    alter table public.customers
      add constraint customers_intake_status_check
      check (intake_status in (
        'draft',
        'incomplete',
        'needs_completion',
        'ready_for_contract',
        'ready_for_operations',
        'blocked',
        'rejected'
      )) not valid;

    alter table public.customers drop constraint if exists customers_intake_quality_score_check;
    alter table public.customers
      add constraint customers_intake_quality_score_check
      check (intake_quality_score is null or (intake_quality_score >= 0 and intake_quality_score <= 100)) not valid;

    create index if not exists customers_company_intake_status_idx
      on public.customers(company_id, intake_status, created_at desc);
    create index if not exists customers_company_email_lower_idx
      on public.customers(company_id, lower(email)) where email is not null;
    create index if not exists customers_company_personal_number_idx
      on public.customers(company_id, personal_number) where personal_number is not null;
    create index if not exists customers_company_org_number_idx
      on public.customers(company_id, org_number) where org_number is not null;
  end if;

  if to_regclass('public.customer_sites') is not null then
    alter table public.customer_sites add column if not exists grid_area_code text null;
    alter table public.customer_sites add column if not exists address_quality_status text null;
    alter table public.customer_sites add column if not exists address_quality_warnings jsonb not null default '[]'::jsonb;
    create index if not exists customer_sites_company_facility_id_idx
      on public.customer_sites(company_id, facility_id) where facility_id is not null;
    create index if not exists customer_sites_company_grid_area_idx
      on public.customer_sites(company_id, grid_area_code) where grid_area_code is not null;
  end if;

  if to_regclass('public.metering_points') is not null then
    alter table public.metering_points add column if not exists grid_area_code text null;
    create index if not exists metering_points_company_meter_point_id_idx
      on public.metering_points(company_id, meter_point_id) where meter_point_id is not null;
  end if;

  if to_regclass('public.customer_contracts') is not null then
    alter table public.customer_contracts add column if not exists expected_start_at date null;
    alter table public.customer_contracts add column if not exists confirmed_start_at date null;
    alter table public.customer_contracts add column if not exists actual_start_at date null;
    alter table public.customer_contracts add column if not exists start_date_source text null;
    alter table public.customer_contracts add column if not exists start_date_blocker_reason text null;
    create index if not exists customer_contracts_company_start_dates_idx
      on public.customer_contracts(company_id, expected_start_at, confirmed_start_at, actual_start_at);
  end if;

  if to_regclass('public.customer_import_batches') is not null then
    alter table public.customer_import_batches add column if not exists source_kind text null;
    alter table public.customer_import_batches add column if not exists source_type text null;
    alter table public.customer_import_batches add column if not exists total_rows integer not null default 0;
    alter table public.customer_import_batches add column if not exists rows_total integer not null default 0;
    alter table public.customer_import_batches add column if not exists created_rows integer not null default 0;
    alter table public.customer_import_batches add column if not exists rows_created integer not null default 0;
    alter table public.customer_import_batches add column if not exists failed_rows integer not null default 0;
    alter table public.customer_import_batches add column if not exists rows_failed integer not null default 0;
    alter table public.customer_import_batches add column if not exists warnings jsonb not null default '[]'::jsonb;
    alter table public.customer_import_batches add column if not exists issues jsonb not null default '[]'::jsonb;
    alter table public.customer_import_batches add column if not exists metadata jsonb not null default '{}'::jsonb;
    alter table public.customer_import_batches add column if not exists imported_at timestamptz null;

    alter table public.customer_import_batches drop constraint if exists customer_import_batches_status_check;
    alter table public.customer_import_batches
      add constraint customer_import_batches_status_check
      check (status in ('previewed', 'completed', 'failed', 'imported', 'partially_imported')) not valid;

    create index if not exists customer_import_batches_company_status_created_idx
      on public.customer_import_batches(company_id, status, created_at desc);
  end if;

  if to_regclass('public.customer_import_rows') is not null then
    alter table public.customer_import_rows add column if not exists error_message text null;
    alter table public.customer_import_rows add column if not exists warnings jsonb not null default '[]'::jsonb;
    alter table public.customer_import_rows add column if not exists issues jsonb not null default '{}'::jsonb;
    alter table public.customer_import_rows add column if not exists parser_confidence integer null;

    alter table public.customer_import_rows drop constraint if exists customer_import_rows_status_check;
    alter table public.customer_import_rows
      add constraint customer_import_rows_status_check
      check (status in (
        'pending',
        'ready_to_create',
        'requires_review',
        'missing_fields',
        'duplicate_warning',
        'created',
        'skipped',
        'failed',
        'rejected'
      )) not valid;

    alter table public.customer_import_rows drop constraint if exists customer_import_rows_parser_confidence_check;
    alter table public.customer_import_rows
      add constraint customer_import_rows_parser_confidence_check
      check (parser_confidence is null or (parser_confidence >= 0 and parser_confidence <= 100)) not valid;

    create index if not exists customer_import_rows_company_status_created_idx
      on public.customer_import_rows(company_id, status, created_at desc);
  end if;

  if to_regclass('public.customer_info_requests') is not null then
    create index if not exists customer_info_requests_company_customer_type_status_idx
      on public.customer_info_requests(company_id, customer_id, request_type, status, created_at desc);
  end if;

  if to_regclass('public.customer_cases') is not null then
    create index if not exists customer_cases_company_customer_source_status_idx
      on public.customer_cases(company_id, customer_id, source, status, created_at desc);
  end if;

  if to_regclass('public.powers_of_attorney') is not null then
    alter table public.powers_of_attorney add column if not exists company_id uuid null;
    alter table public.powers_of_attorney add column if not exists scope_summary jsonb not null default '{}'::jsonb;
    alter table public.powers_of_attorney add column if not exists evidence_note text null;
    create index if not exists powers_of_attorney_company_customer_status_idx
      on public.powers_of_attorney(company_id, customer_id, status, created_at desc);
  end if;
end $$;

-- Policy/report helper for tenant role testing of customer-intake sensitive tables.
create or replace view public.gridex_customer_intake_security_report_v as
select
  c.oid::regclass::text as table_name,
  coalesce(c.relrowsecurity, false) as rls_enabled,
  count(p.policyname)::integer as policy_count,
  array_remove(array_agg(p.policyname order by p.policyname), null) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public'
  and c.relname in (
    'customers',
    'customer_contacts',
    'customer_addresses',
    'customer_sites',
    'metering_points',
    'customer_contracts',
    'powers_of_attorney',
    'customer_info_requests',
    'customer_cases',
    'customer_import_batches',
    'customer_import_rows',
    'audit_logs'
  )
group by c.oid, c.relrowsecurity
order by table_name;
