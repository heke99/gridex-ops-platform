-- Batch Kundintag 1: customer intake validation, readiness metadata and tenant-safe follow-up indexes.
-- Idempotent and additive only. Does not change approved Ediel payload logic.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.customers') is not null then
    alter table public.customers add column if not exists intake_status text not null default 'draft';
    alter table public.customers add column if not exists intake_missing_fields jsonb not null default '[]'::jsonb;
    alter table public.customers add column if not exists intake_quality_score integer null;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.customers'::regclass
        and conname = 'customers_intake_status_check'
    ) then
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
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.customers'::regclass
        and conname = 'customers_intake_quality_score_check'
    ) then
      alter table public.customers
        add constraint customers_intake_quality_score_check
        check (intake_quality_score is null or (intake_quality_score >= 0 and intake_quality_score <= 100)) not valid;
    end if;

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
    create index if not exists customer_sites_company_facility_id_idx
      on public.customer_sites(company_id, facility_id) where facility_id is not null;
  end if;

  if to_regclass('public.metering_points') is not null then
    create index if not exists metering_points_company_meter_point_id_idx
      on public.metering_points(company_id, meter_point_id) where meter_point_id is not null;
  end if;

  if to_regclass('public.customer_info_requests') is not null then
    create index if not exists customer_info_requests_company_customer_type_status_idx
      on public.customer_info_requests(company_id, customer_id, request_type, status, created_at desc);
  end if;

  if to_regclass('public.customer_cases') is not null then
    create index if not exists customer_cases_company_customer_source_status_idx
      on public.customer_cases(company_id, customer_id, source, status, created_at desc);
  end if;
end $$;
