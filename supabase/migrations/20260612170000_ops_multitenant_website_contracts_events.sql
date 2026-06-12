-- OPS multi-tenant website contracts, legal snapshots, customer portal me, and website customer events.
-- Additive/idempotent. Uses existing integration_api_clients as website API clients and existing
-- domain_events/event_outbox/webhook_deliveries as the event backbone.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tenant configurable number sequences for customer-facing documents.
-- -----------------------------------------------------------------------------
alter table if exists public.companies
  add column if not exists contract_number_prefix text,
  add column if not exists application_number_prefix text;

create table if not exists public.company_number_sequences (
  company_id uuid not null references public.companies(id) on delete cascade,
  sequence_key text not null,
  prefix text not null,
  next_number bigint not null default 100001,
  padding integer not null default 6,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, sequence_key),
  constraint company_number_sequences_key_check check (sequence_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint company_number_sequences_prefix_check check (prefix ~ '^[A-Z0-9]{2,16}$'),
  constraint company_number_sequences_next_check check (next_number > 0),
  constraint company_number_sequences_padding_check check (padding between 3 and 12)
);

create or replace function public.gridex_default_document_prefix(p_company_id uuid, p_sequence_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_company_name text;
begin
  select c.name,
         case
           when p_sequence_key = 'contract' then c.contract_number_prefix
           when p_sequence_key = 'application' then c.application_number_prefix
           else null
         end
    into v_company_name, v_prefix
  from public.companies c
  where c.id = p_company_id;

  if v_prefix is null or btrim(v_prefix) = '' then
    v_prefix := case
      when p_sequence_key = 'contract' then 'AVT'
      when p_sequence_key = 'application' then 'APP'
      else upper(left(regexp_replace(coalesce(v_company_name, 'DOC'), '[^A-Za-z0-9]', '', 'g'), 6))
    end;
  end if;

  v_prefix := upper(regexp_replace(v_prefix, '[^A-Z0-9]', '', 'g'));
  if length(v_prefix) < 2 then
    v_prefix := rpad(v_prefix, 2, 'X');
  end if;
  return left(v_prefix, 16);
end;
$$;

create or replace function public.gridex_next_document_number(p_company_id uuid, p_sequence_key text, p_customer_number text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_number bigint;
  v_padding integer;
  v_customer text;
begin
  if p_company_id is null then
    raise exception 'company_id is required';
  end if;
  if p_sequence_key is null or btrim(p_sequence_key) = '' then
    raise exception 'sequence_key is required';
  end if;

  v_prefix := public.gridex_default_document_prefix(p_company_id, p_sequence_key);

  insert into public.company_number_sequences(company_id, sequence_key, prefix, next_number, padding)
  values (p_company_id, p_sequence_key, v_prefix, 100001, 6)
  on conflict (company_id, sequence_key) do nothing;

  update public.company_number_sequences
     set next_number = next_number + 1,
         updated_at = now()
   where company_id = p_company_id
     and sequence_key = p_sequence_key
   returning next_number - 1, prefix, padding
    into v_number, v_prefix, v_padding;

  if v_number is null then
    raise exception 'could not reserve document number';
  end if;

  v_customer := nullif(regexp_replace(coalesce(p_customer_number, ''), '[^A-Za-z0-9-]', '', 'g'), '');
  if p_sequence_key = 'contract' and v_customer is not null then
    return v_prefix || '-' || v_customer || '-' || lpad(v_number::text, v_padding, '0');
  end if;

  if p_sequence_key = 'application' then
    return v_prefix || '-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_number::text, v_padding, '0');
  end if;

  return v_prefix || '-' || lpad(v_number::text, v_padding, '0');
end;
$$;

create or replace function public.gridex_next_contract_number(p_company_id uuid, p_customer_number text default null)
returns text
language sql
security definer
set search_path = public
as $$
  select public.gridex_next_document_number(p_company_id, 'contract', p_customer_number);
$$;

create or replace function public.gridex_next_application_number(p_company_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  select public.gridex_next_document_number(p_company_id, 'application', null);
$$;

-- -----------------------------------------------------------------------------
-- Public contract offers owned by OPS per tenant. Websites read via API-client,
-- never by sending company_id from the frontend.
-- -----------------------------------------------------------------------------
create table if not exists public.public_contract_offers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  price_plan_id uuid references public.price_plans(id) on delete set null,
  price_plan_version_id uuid references public.price_plan_versions(id) on delete set null,
  campaign_version_id uuid references public.campaign_versions(id) on delete set null,
  product_code text not null default 'electricity',
  public_name text not null,
  public_description text,
  contract_type text not null default 'spot',
  billing_model text,
  customer_type text not null default 'both',
  monthly_fee_sek numeric,
  invoice_fee_sek numeric,
  markup_ore_per_kwh numeric,
  spot_markup_ore_per_kwh numeric,
  variable_fee_ore_per_kwh numeric,
  fixed_price_ore_per_kwh numeric,
  green_fee_mode text,
  green_fee_value numeric,
  terms_version text,
  valid_from date,
  valid_to date,
  is_public boolean not null default false,
  is_archived boolean not null default false,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_contract_offers_customer_type_check check (customer_type in ('private','business','both')),
  constraint public_contract_offers_valid_window_check check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create index if not exists public_contract_offers_company_public_idx
  on public.public_contract_offers(company_id, is_public, is_archived, sort_order, public_name);
create index if not exists public_contract_offers_price_version_idx
  on public.public_contract_offers(company_id, price_plan_version_id)
  where price_plan_version_id is not null;
create index if not exists public_contract_offers_product_idx
  on public.public_contract_offers(company_id, product_code)
  where is_public = true and is_archived = false;

alter table public.public_contract_offers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'public_contract_offers' and policyname = 'public_contract_offers_service_role_all'
  ) then
    create policy public_contract_offers_service_role_all
      on public.public_contract_offers
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'public_contract_offers' and policyname = 'public_contract_offers_tenant_read'
  ) then
    create policy public_contract_offers_tenant_read
      on public.public_contract_offers
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Customer contracts and website applications get first-class customer-facing ids
-- and selected price plan references.
-- -----------------------------------------------------------------------------
alter table if exists public.customer_contracts
  add column if not exists contract_number text,
  add column if not exists price_plan_id uuid references public.price_plans(id) on delete set null,
  add column if not exists price_plan_version_id uuid references public.price_plan_versions(id) on delete set null,
  add column if not exists invoice_fee_sek numeric,
  add column if not exists markup_ore_per_kwh numeric,
  add column if not exists contract_price_snapshot_id uuid;

create unique index if not exists customer_contracts_company_contract_number_uidx
  on public.customer_contracts(company_id, contract_number)
  where contract_number is not null;
create index if not exists customer_contracts_company_price_version_idx
  on public.customer_contracts(company_id, price_plan_version_id, created_at desc)
  where price_plan_version_id is not null;

alter table if exists public.website_customer_applications
  add column if not exists application_number text,
  add column if not exists contract_number text,
  add column if not exists price_plan_id uuid references public.price_plans(id) on delete set null,
  add column if not exists price_plan_version_id uuid references public.price_plan_versions(id) on delete set null,
  add column if not exists contract_price_snapshot_id uuid references public.contract_price_snapshots(id) on delete set null;

create unique index if not exists website_customer_applications_company_application_number_uidx
  on public.website_customer_applications(company_id, application_number)
  where application_number is not null;
create index if not exists website_customer_applications_company_contract_number_idx
  on public.website_customer_applications(company_id, contract_number, created_at desc)
  where contract_number is not null;
create index if not exists website_customer_applications_company_price_version_idx
  on public.website_customer_applications(company_id, price_plan_version_id, created_at desc)
  where price_plan_version_id is not null;

alter table if exists public.external_contract_intakes
  add column if not exists application_number text,
  add column if not exists contract_number text;

create index if not exists external_contract_intakes_company_application_number_idx
  on public.external_contract_intakes(company_id, application_number)
  where application_number is not null;
create index if not exists external_contract_intakes_company_contract_number_idx
  on public.external_contract_intakes(company_id, contract_number)
  where contract_number is not null;

alter table if exists public.contract_price_snapshots
  add column if not exists contract_number text,
  add column if not exists customer_number text,
  add column if not exists source text not null default 'pricing_engine';

-- -----------------------------------------------------------------------------
-- Customer events: canonical audit/event table for website/portal customer actions.
-- domain_events remains the dispatch/outbox source of truth.
-- -----------------------------------------------------------------------------
create table if not exists public.customer_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  api_client_id uuid references public.integration_api_clients(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  portal_identity_id uuid references public.customer_portal_identities(id) on delete set null,
  external_customer_id text,
  event_type text not null,
  source text not null default 'website',
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint customer_events_event_type_check check (event_type ~ '^customer\.[a-z0-9_]+$')
);

create unique index if not exists customer_events_company_idempotency_uidx
  on public.customer_events(company_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists customer_events_company_customer_idx
  on public.customer_events(company_id, customer_id, occurred_at desc)
  where customer_id is not null;
create index if not exists customer_events_company_external_idx
  on public.customer_events(company_id, external_customer_id, occurred_at desc)
  where external_customer_id is not null;
create index if not exists customer_events_company_type_idx
  on public.customer_events(company_id, event_type, occurred_at desc);

alter table public.customer_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_events' and policyname = 'customer_events_service_role_all'
  ) then
    create policy customer_events_service_role_all
      on public.customer_events
      for all to service_role
      using (true)
      with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'customer_events' and policyname = 'customer_events_tenant_read'
  ) then
    create policy customer_events_tenant_read
      on public.customer_events
      for select
      using (public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
end $$;

-- Recommended integration scopes for website clients:
-- website_contracts.read, website_applications.write, website_events.write,
-- customer_portal.read, customer_portal.write, events.read.
