-- Batch 4C: fakturering, partnerexport, audit, readiness och säker AI/OCR-granskningskö.
-- Defensiv migration: lägger endast till saknade fält/tabeller och påverkar inte godkända Ediel-flöden.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.customer_contracts') is not null then
    alter table public.customer_contracts add column if not exists contract_version text not null default 'v1';
    alter table public.customer_contracts add column if not exists signed_version text null;
    alter table public.customer_contracts add column if not exists terms_signed_version text null;
    alter table public.customer_contracts add column if not exists version_snapshot jsonb not null default '{}'::jsonb;
    alter table public.customer_contracts add column if not exists start_status text not null default 'start_date_missing';
    alter table public.customer_contracts add column if not exists old_supplier_start_at date null;
    alter table public.customer_contracts add column if not exists grid_owner_confirmed_start_at date null;
    alter table public.customer_contracts add column if not exists ediel_confirmed_start_at date null;
    alter table public.customer_contracts add column if not exists export_blocked boolean not null default false;
    alter table public.customer_contracts add column if not exists export_block_reason text null;

    -- Backfill start_status defensively. Older Gridex installs do not always have the same
    -- start-date columns, so every column reference is guarded before dynamic execution.
    execute 'update public.customer_contracts set start_status = coalesce(start_status, ''start_date_missing'') where start_status is null';

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'actual_start_at') then
      execute 'update public.customer_contracts set start_status = ''active_from_date'' where actual_start_at is not null and (start_status is null or start_status = ''start_date_missing'')';
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'confirmed_start_at') then
      execute 'update public.customer_contracts set start_status = ''confirmed_start_date'' where confirmed_start_at is not null and (start_status is null or start_status = ''start_date_missing'')';
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'expected_start_at') then
      execute 'update public.customer_contracts set start_status = ''preliminary_start_date'' where expected_start_at is not null and (start_status is null or start_status = ''start_date_missing'')';
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'starts_at') then
      execute 'update public.customer_contracts set start_status = ''requested_start_date'' where starts_at is not null and (start_status is null or start_status = ''start_date_missing'')';
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'company_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'start_status')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'status') then
      execute 'create index if not exists customer_contracts_company_start_status_idx on public.customer_contracts(company_id, start_status, status) where company_id is not null';
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'company_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'contract_version')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'campaign_version')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'price_version')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contracts' and column_name = 'terms_version') then
      execute 'create index if not exists customer_contracts_company_versions_idx on public.customer_contracts(company_id, contract_version, campaign_version, price_version, terms_version) where company_id is not null';
    end if;
  end if;

  if to_regclass('public.contract_offers') is not null then
    alter table public.contract_offers add column if not exists offer_version text not null default 'v1';
    alter table public.contract_offers add column if not exists terms_document_url text null;
    alter table public.contract_offers add column if not exists version_snapshot jsonb not null default '{}'::jsonb;
  end if;

  if to_regclass('public.billing_export_runs') is not null then
    alter table public.billing_export_runs add column if not exists metadata jsonb not null default '{}'::jsonb;
    alter table public.billing_export_runs add column if not exists adapter_key text not null default 'gridex_billing_partner_v1';
    alter table public.billing_export_runs add column if not exists payload_version text not null default 'billing_export_v4c';
    alter table public.billing_export_runs add column if not exists retry_policy jsonb not null default '{"maxAttempts":3,"strategy":"manual_retry"}'::jsonb;
    alter table public.billing_export_runs add column if not exists partner_response_log jsonb not null default '[]'::jsonb;
    alter table public.billing_export_runs add column if not exists last_partner_response_at timestamptz null;
    alter table public.billing_export_runs add column if not exists updated_at timestamptz not null default now();
  end if;

  if to_regclass('public.billing_export_run_items') is not null then
    alter table public.billing_export_run_items add column if not exists payload_version text not null default 'billing_export_item_v4c';
    alter table public.billing_export_run_items add column if not exists adapter_key text not null default 'gridex_billing_partner_v1';
    alter table public.billing_export_run_items add column if not exists adapter_payload_snapshot jsonb not null default '{}'::jsonb;
    alter table public.billing_export_run_items add column if not exists partner_response_log jsonb not null default '[]'::jsonb;
    alter table public.billing_export_run_items add column if not exists last_partner_response_at timestamptz null;
    alter table public.billing_export_run_items add column if not exists external_reference text null;
    alter table public.billing_export_run_items add column if not exists sent_by uuid null;
  end if;

  if to_regclass('public.partner_exports') is not null then
    alter table public.partner_exports add column if not exists idempotency_key text null;
    alter table public.partner_exports add column if not exists retry_count integer not null default 0;
    alter table public.partner_exports add column if not exists adapter_key text not null default 'gridex_billing_partner_v1';
    alter table public.partner_exports add column if not exists payload_version text not null default 'partner_export_v4c';
    alter table public.partner_exports add column if not exists partner_response_log jsonb not null default '[]'::jsonb;
    alter table public.partner_exports add column if not exists last_partner_response_at timestamptz null;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_exports' and column_name = 'company_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_exports' and column_name = 'idempotency_key') then
      execute 'create unique index if not exists partner_exports_company_idempotency_uidx on public.partner_exports(company_id, idempotency_key) where company_id is not null and idempotency_key is not null';
    end if;
  end if;
end $$;

create table if not exists public.customer_readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  customer_id uuid not null,
  customer_score integer not null default 0,
  contract_score integer not null default 0,
  power_of_attorney_score integer not null default 0,
  site_score integer not null default 0,
  billing_score integer not null default 0,
  ready_for_contract boolean not null default false,
  ready_for_switch boolean not null default false,
  ready_for_billing boolean not null default false,
  ready_for_export boolean not null default false,
  blockers jsonb not null default '[]'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  calculated_by uuid null,
  calculated_at timestamptz not null default now()
);

create index if not exists customer_readiness_snapshots_company_customer_idx
  on public.customer_readiness_snapshots(company_id, customer_id, calculated_at desc);
create index if not exists customer_readiness_snapshots_company_ready_idx
  on public.customer_readiness_snapshots(company_id, ready_for_contract, ready_for_switch, ready_for_billing, ready_for_export);

create table if not exists public.document_ai_extractions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  customer_id uuid null,
  source_file_name text null,
  source_document_id uuid null,
  extraction_type text not null default 'contract_or_poa_review',
  status text not null default 'needs_review',
  raw_text text null,
  extracted_fields jsonb not null default '{}'::jsonb,
  field_confidence jsonb not null default '{}'::jsonb,
  detected_signatures jsonb not null default '[]'::jsonb,
  detected_authorizations jsonb not null default '[]'::jsonb,
  detected_sites jsonb not null default '[]'::jsonb,
  detected_invoice_address jsonb not null default '{}'::jsonb,
  review_notes text null,
  reviewed_by uuid null,
  reviewed_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_ai_extractions_company_status_idx
  on public.document_ai_extractions(company_id, status, created_at desc);
create index if not exists document_ai_extractions_company_customer_idx
  on public.document_ai_extractions(company_id, customer_id, created_at desc)
  where customer_id is not null;

create table if not exists public.batch4c_security_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  check_key text not null,
  check_area text not null,
  expected_result text not null,
  actual_result text null,
  status text not null default 'not_run',
  evidence jsonb not null default '{}'::jsonb,
  checked_by uuid null,
  checked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists batch4c_security_checks_company_key_uidx
  on public.batch4c_security_checks(coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), check_key);

alter table public.customer_readiness_snapshots enable row level security;
alter table public.document_ai_extractions enable row level security;
alter table public.batch4c_security_checks enable row level security;

do $$
begin
  if to_regclass('public.company_memberships') is not null then
    drop policy if exists customer_readiness_snapshots_company_members on public.customer_readiness_snapshots;
    create policy customer_readiness_snapshots_company_members on public.customer_readiness_snapshots
      for all using (
        exists (select 1 from public.company_memberships cm where cm.company_id = customer_readiness_snapshots.company_id and cm.user_id = auth.uid())
      ) with check (
        exists (select 1 from public.company_memberships cm where cm.company_id = customer_readiness_snapshots.company_id and cm.user_id = auth.uid())
      );

    drop policy if exists document_ai_extractions_company_members on public.document_ai_extractions;
    create policy document_ai_extractions_company_members on public.document_ai_extractions
      for all using (
        exists (select 1 from public.company_memberships cm where cm.company_id = document_ai_extractions.company_id and cm.user_id = auth.uid())
      ) with check (
        exists (select 1 from public.company_memberships cm where cm.company_id = document_ai_extractions.company_id and cm.user_id = auth.uid())
      );

    drop policy if exists batch4c_security_checks_company_members on public.batch4c_security_checks;
    create policy batch4c_security_checks_company_members on public.batch4c_security_checks
      for all using (
        company_id is null or exists (select 1 from public.company_memberships cm where cm.company_id = batch4c_security_checks.company_id and cm.user_id = auth.uid())
      ) with check (
        company_id is null or exists (select 1 from public.company_memberships cm where cm.company_id = batch4c_security_checks.company_id and cm.user_id = auth.uid())
      );
  end if;
end $$;

create or replace view public.gridex_batch4c_role_action_security_v as
select * from (
  values
    ('super_admin','tenant_overview','Ska se alla bolag, blockers, faktureringsstatus, go-live och tenant-statistik.', true),
    ('company_admin','company_scope','Ska endast kunna skapa/importera kunder, avtal och kampanjer i eget bolag.', true),
    ('company_admin','company_id_tamper','Manipulerad company_id ska blockeras i server actions.', true),
    ('customer_service','pricing_block','Kundservice ska inte kunna ändra prismotor eller kampanjer via action.', true),
    ('customer_service','ediel_block','Kundservice ska inte kunna aktivera live eller ändra Ediel-inställningar.', true),
    ('finance','billing_export','Ekonomi ska kunna se faktureringsunderlag/exportstatus om rollen tillåter.', true),
    ('finance','ediel_block','Ekonomi ska inte kunna ändra aktörsprofil eller production routes.', true),
    ('all_roles','audit_required','Känsliga actions ska skapa audit med före/efter-värden där möjligt.', true)
) as t(role_key, test_area, expected_control, must_pass);
