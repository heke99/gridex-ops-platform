-- Batch N: Multi-tenant integrity, EDIFACT dedupe and atomic claim locks
-- Purpose: protect tenant-owned relationships at database level and make
-- inbound/outbox processing concurrency-safe for shared mailbox operations.
-- Idempotent by design: all schema changes are guarded with IF EXISTS / IF NOT EXISTS.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) Tenant integrity support
-- -----------------------------------------------------------------------------

create or replace function public.gridex_assert_same_company(
  p_child_company_id uuid,
  p_parent_company_id uuid,
  p_child_table text,
  p_reference_column text
)
returns void
language plpgsql
as $$
begin
  if p_child_company_id is not null
     and p_parent_company_id is not null
     and p_child_company_id <> p_parent_company_id then
    raise exception 'Cross-tenant reference blocked: %.% does not belong to company_id %',
      p_child_table, p_reference_column, p_child_company_id
      using errcode = '23514';
  end if;
end;
$$;

-- Add (company_id, id) uniqueness to root/relationship tables where the columns exist.
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers',
    'customer_sites',
    'metering_points',
    'customer_contracts',
    'contract_price_snapshots',
    'customer_legal_acceptances',
    'powers_of_attorney',
    'customer_documents',
    'documents',
    'billing_underlays',
    'billing_underlay_items',
    'metering_values',
    'normalized_metering_values',
    'supplier_switch_requests',
    'supplier_switch_events',
    'ediel_messages',
    'ediel_message_events',
    'ediel_outbox'
  ] loop
    if to_regclass('public.' || t) is not null
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'company_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'id') then
      execute format('create unique index if not exists %I on public.%I(company_id, id)', 'idx_' || t || '_company_id_id_uidx', t);
    end if;
  end loop;
end $$;

create or replace function public.gridex_customer_sites_company_guard()
returns trigger
language plpgsql
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;
  return new;
end;
$$;

create or replace function public.gridex_metering_points_company_guard()
returns trigger
language plpgsql
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;

  if new.site_id is not null and to_regclass('public.customer_sites') is not null then
    select company_id into parent_company_id from public.customer_sites where id = new.site_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'site_id');
  end if;

  return new;
end;
$$;

create or replace function public.gridex_customer_contracts_company_guard()
returns trigger
language plpgsql
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;

  if new.site_id is not null and to_regclass('public.customer_sites') is not null then
    select company_id into parent_company_id from public.customer_sites where id = new.site_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'site_id');
  end if;

  if new.customer_site_id is not null and to_regclass('public.customer_sites') is not null then
    select company_id into parent_company_id from public.customer_sites where id = new.customer_site_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_site_id');
  end if;

  if new.metering_point_id is not null and to_regclass('public.metering_points') is not null then
    select company_id into parent_company_id from public.metering_points where id = new.metering_point_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'metering_point_id');
  end if;

  return new;
end;
$$;

create or replace function public.gridex_contract_price_snapshots_company_guard()
returns trigger
language plpgsql
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_contract_id is not null and to_regclass('public.customer_contracts') is not null then
    select company_id into parent_company_id from public.customer_contracts where id = new.customer_contract_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_contract_id');
  elsif new.contract_id is not null and to_regclass('public.customer_contracts') is not null then
    select company_id into parent_company_id from public.customer_contracts where id = new.contract_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'contract_id');
  end if;
  return new;
end;
$$;

create or replace function public.gridex_customer_legal_acceptances_company_guard()
returns trigger
language plpgsql
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;
  if new.contract_id is not null and to_regclass('public.customer_contracts') is not null then
    select company_id into parent_company_id from public.customer_contracts where id = new.contract_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'contract_id');
  end if;
  return new;
end;
$$;

create or replace function public.gridex_powers_of_attorney_company_guard()
returns trigger
language plpgsql
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;
  if new.site_id is not null and to_regclass('public.customer_sites') is not null then
    select company_id into parent_company_id from public.customer_sites where id = new.site_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'site_id');
  end if;
  if new.metering_point_id is not null and to_regclass('public.metering_points') is not null then
    select company_id into parent_company_id from public.metering_points where id = new.metering_point_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'metering_point_id');
  end if;
  return new;
end;
$$;

create or replace function public.gridex_billing_underlays_company_guard()
returns trigger
language plpgsql
as $$
declare
  parent_company_id uuid;
begin
  if new.customer_id is not null and to_regclass('public.customers') is not null then
    select company_id into parent_company_id from public.customers where id = new.customer_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_id');
  end if;
  if new.customer_contract_id is not null and to_regclass('public.customer_contracts') is not null then
    select company_id into parent_company_id from public.customer_contracts where id = new.customer_contract_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'customer_contract_id');
  elsif new.contract_id is not null and to_regclass('public.customer_contracts') is not null then
    select company_id into parent_company_id from public.customer_contracts where id = new.contract_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'contract_id');
  end if;
  if new.site_id is not null and to_regclass('public.customer_sites') is not null then
    select company_id into parent_company_id from public.customer_sites where id = new.site_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'site_id');
  end if;
  if new.metering_point_id is not null and to_regclass('public.metering_points') is not null then
    select company_id into parent_company_id from public.metering_points where id = new.metering_point_id;
    perform public.gridex_assert_same_company(new.company_id, parent_company_id, TG_TABLE_NAME, 'metering_point_id');
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.customer_sites') is not null then
    drop trigger if exists gridex_customer_sites_company_guard_tg on public.customer_sites;
    create trigger gridex_customer_sites_company_guard_tg before insert or update on public.customer_sites
      for each row execute function public.gridex_customer_sites_company_guard();
  end if;

  if to_regclass('public.metering_points') is not null then
    drop trigger if exists gridex_metering_points_company_guard_tg on public.metering_points;
    create trigger gridex_metering_points_company_guard_tg before insert or update on public.metering_points
      for each row execute function public.gridex_metering_points_company_guard();
  end if;

  if to_regclass('public.customer_contracts') is not null then
    drop trigger if exists gridex_customer_contracts_company_guard_tg on public.customer_contracts;
    create trigger gridex_customer_contracts_company_guard_tg before insert or update on public.customer_contracts
      for each row execute function public.gridex_customer_contracts_company_guard();
  end if;

  if to_regclass('public.contract_price_snapshots') is not null then
    drop trigger if exists gridex_contract_price_snapshots_company_guard_tg on public.contract_price_snapshots;
    create trigger gridex_contract_price_snapshots_company_guard_tg before insert or update on public.contract_price_snapshots
      for each row execute function public.gridex_contract_price_snapshots_company_guard();
  end if;

  if to_regclass('public.customer_legal_acceptances') is not null then
    drop trigger if exists gridex_customer_legal_acceptances_company_guard_tg on public.customer_legal_acceptances;
    create trigger gridex_customer_legal_acceptances_company_guard_tg before insert or update on public.customer_legal_acceptances
      for each row execute function public.gridex_customer_legal_acceptances_company_guard();
  end if;

  if to_regclass('public.powers_of_attorney') is not null then
    drop trigger if exists gridex_powers_of_attorney_company_guard_tg on public.powers_of_attorney;
    create trigger gridex_powers_of_attorney_company_guard_tg before insert or update on public.powers_of_attorney
      for each row execute function public.gridex_powers_of_attorney_company_guard();
  end if;

  if to_regclass('public.billing_underlays') is not null then
    drop trigger if exists gridex_billing_underlays_company_guard_tg on public.billing_underlays;
    create trigger gridex_billing_underlays_company_guard_tg before insert or update on public.billing_underlays
      for each row execute function public.gridex_billing_underlays_company_guard();
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2) Tenant-safe inbound dedupe indexes and audit columns
-- -----------------------------------------------------------------------------

alter table if exists public.inbound_email_messages add column if not exists raw_message_sha256 text;
alter table if exists public.inbound_email_messages add column if not exists dedupe_scope text;
alter table if exists public.inbound_email_messages add column if not exists dedupe_reason text;
alter table if exists public.inbound_email_messages add column if not exists duplicate_of_id uuid;

create unique index if not exists idx_inbound_email_mailbox_message_id_uidx
  on public.inbound_email_messages(mailbox_id, internet_message_id)
  where internet_message_id is not null;

create unique index if not exists idx_inbound_email_mailbox_raw_hash_uidx
  on public.inbound_email_messages(mailbox_id, raw_message_sha256)
  where raw_message_sha256 is not null;

create unique index if not exists idx_inbound_email_company_interchange_uidx
  on public.inbound_email_messages(environment, company_id, sender_ediel_id, interchange_reference)
  where company_id is not null and sender_ediel_id is not null and interchange_reference is not null;

create unique index if not exists idx_inbound_email_company_transaction_external_uidx
  on public.inbound_email_messages(environment, company_id, sender_ediel_id, transaction_reference, external_reference)
  where company_id is not null and sender_ediel_id is not null and transaction_reference is not null and external_reference is not null;

-- -----------------------------------------------------------------------------
-- 3) Atomic inbound processing claim
-- -----------------------------------------------------------------------------

alter table if exists public.inbound_processing_jobs add column if not exists locked_at timestamptz;
alter table if exists public.inbound_processing_jobs add column if not exists locked_by text;
alter table if exists public.inbound_processing_jobs add column if not exists started_at timestamptz;
alter table if exists public.inbound_processing_jobs add column if not exists finished_at timestamptz;
alter table if exists public.inbound_processing_jobs add column if not exists attempts_count integer not null default 0;

create index if not exists idx_inbound_processing_jobs_claim
  on public.inbound_processing_jobs(status, locked_at, created_at);

create or replace function public.claim_inbound_processing_jobs(
  p_environment text default null,
  p_limit integer default 50,
  p_worker_id text default 'inbound-mail-engine',
  p_stale_after interval default interval '10 minutes'
)
returns setof public.inbound_processing_jobs
language plpgsql
as $$
begin
  return query
  with candidates as (
    select j.id
    from public.inbound_processing_jobs j
    left join public.inbound_email_messages m on m.id = j.inbound_email_message_id
    where j.status in ('queued', 'retry', 'received')
      and (j.locked_at is null or j.locked_at < now() - p_stale_after)
      and (p_environment is null or coalesce(m.environment, 'test') = p_environment)
    order by j.created_at asc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
    -- FOR UPDATE must target only inbound_processing_jobs: the LEFT JOIN makes
    -- inbound_email_messages the nullable side of an outer join, which cannot be
    -- locked ("FOR UPDATE cannot be applied to the nullable side of an outer join").
    for update of j skip locked
  ), updated as (
    update public.inbound_processing_jobs j
       set status = 'processing',
           step = 'processor_claimed',
           locked_at = now(),
           locked_by = p_worker_id,
           started_at = now(),
           finished_at = null,
           attempts_count = coalesce(j.attempts_count, 0) + 1,
           error_message = null,
           updated_at = now()
     where j.id in (select id from candidates)
     returning j.*
  )
  select * from updated;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) Atomic EDIFACT outbox claim
-- -----------------------------------------------------------------------------

alter table if exists public.ediel_outbox add column if not exists locked_at timestamptz;
alter table if exists public.ediel_outbox add column if not exists locked_by text;
alter table if exists public.ediel_outbox add column if not exists send_attempt_count integer not null default 0;
alter table if exists public.ediel_outbox add column if not exists current_send_attempt_id uuid;
alter table if exists public.ediel_outbox add column if not exists smtp_message_id text;
alter table if exists public.ediel_outbox add column if not exists transport_channel text;
alter table if exists public.ediel_outbox add column if not exists receiver_ediel_id text;
alter table if exists public.ediel_outbox add column if not exists receiver_subaddress text;
alter table if exists public.ediel_outbox add column if not exists certificate_fingerprint text;

create index if not exists idx_ediel_outbox_claim
  on public.ediel_outbox(environment, company_id, status, locked_at, priority, created_at);

create or replace function public.claim_ediel_outbox_items(
  p_environment text default null,
  p_company_id uuid default null,
  p_limit integer default 25,
  p_worker_id text default 'ediel-outbox-engine',
  p_stale_after interval default interval '10 minutes'
)
returns setof public.ediel_outbox
language plpgsql
as $$
begin
  return query
  with candidates as (
    select id
    from public.ediel_outbox
    where status in ('prepared', 'queued')
      and (locked_at is null or locked_at < now() - p_stale_after)
      and (p_environment is null or environment = p_environment)
      and (p_company_id is null or company_id = p_company_id)
    order by priority asc, created_at asc
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked
  ), updated as (
    update public.ediel_outbox o
       set status = 'sending',
           locked_at = now(),
           locked_by = p_worker_id,
           attempts = coalesce(o.attempts, 0) + 1,
           send_attempt_count = coalesce(o.send_attempt_count, 0) + 1,
           current_send_attempt_id = gen_random_uuid(),
           updated_at = now()
     where o.id in (select id from candidates)
     returning o.*
  )
  select * from updated;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) OCR/document staging columns
-- -----------------------------------------------------------------------------

alter table if exists public.document_ai_extractions add column if not exists parser_vendor text;
alter table if exists public.document_ai_extractions add column if not exists parser_version text;
alter table if exists public.document_ai_extractions add column if not exists ocr_status text;
alter table if exists public.document_ai_extractions add column if not exists source_file_sha256 text;
alter table if exists public.document_ai_extractions add column if not exists storage_path text;
alter table if exists public.document_ai_extractions add column if not exists mime_type text;
alter table if exists public.document_ai_extractions add column if not exists raw_extracted_json jsonb not null default '{}'::jsonb;
alter table if exists public.document_ai_extractions add column if not exists normalized_rows jsonb not null default '[]'::jsonb;
alter table if exists public.document_ai_extractions add column if not exists parser_warnings jsonb not null default '[]'::jsonb;
alter table if exists public.document_ai_extractions add column if not exists bounding_boxes jsonb not null default '{}'::jsonb;
alter table if exists public.document_ai_extractions add column if not exists conflict_reasons jsonb not null default '[]'::jsonb;
alter table if exists public.document_ai_extractions add column if not exists approved_by uuid;
alter table if exists public.document_ai_extractions add column if not exists approved_at timestamptz;
alter table if exists public.document_ai_extractions add column if not exists applied_at timestamptz;
alter table if exists public.document_ai_extractions add column if not exists applied_changes jsonb not null default '{}'::jsonb;

create table if not exists public.document_parse_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid null references public.customers(id) on delete set null,
  document_ai_extraction_id uuid null references public.document_ai_extractions(id) on delete set null,
  storage_path text null,
  source_file_sha256 text null,
  mime_type text null,
  parser_vendor text null,
  parser_version text null,
  status text not null default 'queued',
  review_status text not null default 'needs_review',
  payload jsonb not null default '{}'::jsonb,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  updated_by uuid null
);

create index if not exists idx_document_parse_jobs_company_status
  on public.document_parse_jobs(company_id, status, created_at desc);

-- -----------------------------------------------------------------------------
-- Verification notes
-- -----------------------------------------------------------------------------
-- Required manual SQL checks after migration:
-- 1. Insert customer_site for company B using customer_id from company A: must raise Cross-tenant reference blocked.
-- 2. Insert metering_point for company B using site_id/customer_id from company A: must raise Cross-tenant reference blocked.
-- 3. Insert customer_contract for company B using customer/site/metering_point from company A: must raise Cross-tenant reference blocked.
-- 4. Create inbound_email_messages with same interchange_reference for different company_id values: both must be allowed.
-- 5. Run claim_inbound_processing_jobs concurrently: each job should be returned once.
-- 6. Run claim_ediel_outbox_items concurrently: each outbox row should be returned once.
