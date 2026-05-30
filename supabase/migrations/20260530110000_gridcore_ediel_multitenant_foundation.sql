-- GridCore Ediel multitenant SaaS foundation
-- Idempotent, additive, non-destructive. Existing canonical tables are extended in place.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Existing-table mappings used by this migration:
-- - required meter_values concept maps to existing public.metering_values
-- - required meter_data_permission_requests concept maps to existing public.metering_permissions
-- - required customer_site_id maps to existing customer_sites.id / metering_points.site_id
-- ---------------------------------------------------------------------------

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  org_number text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

alter table public.companies
  add column if not exists org_number text,
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.ediel_actor_settings
  add column if not exists market text,
  add column if not exists role text,
  add column if not exists ediel_id text,
  add column if not exists sender_subaddress text,
  add column if not exists receiver_subaddress text,
  add column if not exists created_at timestamptz not null default now();

update public.ediel_actor_settings
set ediel_id = coalesce(ediel_id, actor_ediel_id),
    role = coalesce(role, actor_role),
    sender_subaddress = coalesce(sender_subaddress, sender_sub_address)
where to_regclass('public.ediel_actor_settings') is not null;

create index if not exists idx_ediel_actor_settings_tenant_actor
  on public.ediel_actor_settings(company_id, environment, ediel_id, sender_subaddress, receiver_subaddress)
  where coalesce(is_active, true) = true;

create index if not exists idx_ediel_actor_settings_legacy_actor
  on public.ediel_actor_settings(company_id, environment, actor_ediel_id, sender_sub_address)
  where coalesce(is_active, true) = true;

alter table if exists public.ediel_route_profiles
  add column if not exists message_family text,
  add column if not exists message_code text,
  add column if not exists own_ediel_id text,
  add column if not exists own_subaddress text,
  add column if not exists counterparty_ediel_id text,
  add column if not exists counterparty_subaddress text,
  add column if not exists mailbox_id uuid,
  add column if not exists transport_type text,
  add column if not exists ack_policy text,
  add column if not exists is_active boolean,
  add column if not exists created_at timestamptz not null default now();

update public.ediel_route_profiles
set own_ediel_id = coalesce(own_ediel_id, sender_ediel_id),
    own_subaddress = coalesce(own_subaddress, sender_sub_address),
    counterparty_ediel_id = coalesce(counterparty_ediel_id, receiver_ediel_id),
    counterparty_subaddress = coalesce(counterparty_subaddress, receiver_sub_address),
    ack_policy = coalesce(ack_policy, ack_mode),
    is_active = coalesce(is_active, is_enabled),
    transport_type = coalesce(transport_type, 'email')
where to_regclass('public.ediel_route_profiles') is not null;

create index if not exists idx_ediel_route_profiles_inbound_resolution
  on public.ediel_route_profiles(environment, own_ediel_id, own_subaddress, application_reference, message_family, message_code, company_id)
  where coalesce(is_active, is_enabled, true) = true;

create index if not exists idx_ediel_route_profiles_legacy_inbound_resolution
  on public.ediel_route_profiles(environment, receiver_ediel_id, receiver_sub_address, application_reference, company_id)
  where coalesce(is_active, is_enabled, true) = true;

alter table if exists public.customers
  add column if not exists identity_number text,
  add column if not exists organization_number text,
  add column if not exists name text,
  add column if not exists created_at timestamptz not null default now();

update public.customers
set identity_number = coalesce(identity_number, personal_number),
    organization_number = coalesce(organization_number, org_number),
    name = coalesce(name, full_name, company_name, nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''))
where to_regclass('public.customers') is not null;

alter table if exists public.customer_sites
  add column if not exists customer_site_id uuid,
  add column if not exists address text,
  add column if not exists grid_area_code text,
  add column if not exists grid_owner_ediel_id text,
  add column if not exists created_at timestamptz not null default now();

update public.customer_sites
set customer_site_id = coalesce(customer_site_id, id),
    address = coalesce(address, street)
where to_regclass('public.customer_sites') is not null;

create index if not exists idx_customer_sites_company_customer_status
  on public.customer_sites(company_id, customer_id, status);

alter table if exists public.metering_points
  add column if not exists customer_site_id uuid,
  add column if not exists grid_area_code text,
  add column if not exists grid_owner_ediel_id text,
  add column if not exists meter_number text,
  add column if not exists settlement_method text,
  add column if not exists product_direction text,
  add column if not exists created_at timestamptz not null default now();

update public.metering_points
set customer_site_id = coalesce(customer_site_id, site_id),
    product_direction = coalesce(product_direction, measurement_type),
    settlement_method = coalesce(settlement_method, reading_frequency)
where to_regclass('public.metering_points') is not null;

create or replace view public.gridcore_ediel_duplicate_metering_points_v
with (security_invoker = true)
as
select company_id, metering_point_id, count(*) as duplicate_count, array_agg(id order by created_at, id) as row_ids
from public.metering_points
where company_id is not null and metering_point_id is not null
group by company_id, metering_point_id
having count(*) > 1;

do $$
begin
  if not exists (select 1 from public.gridcore_ediel_duplicate_metering_points_v) then
    create unique index if not exists ux_metering_points_company_metering_point_id
      on public.metering_points(company_id, metering_point_id)
      where company_id is not null and metering_point_id is not null;
  end if;
end $$;

create index if not exists idx_metering_points_company_lookup
  on public.metering_points(company_id, metering_point_id, meter_point_id, ediel_reference);

alter table if exists public.ediel_messages
  add column if not exists unb_sender_id text,
  add column if not exists unb_sender_subaddress text,
  add column if not exists unb_receiver_id text,
  add column if not exists unb_receiver_subaddress text,
  add column if not exists message_reference text,
  add column if not exists bgm_code text,
  add column if not exists bgm_reference text,
  add column if not exists tenant_resolution_status text,
  add column if not exists business_match_status text,
  add column if not exists ack_status text,
  add column if not exists processing_status text,
  add column if not exists created_at timestamptz not null default now();

update public.ediel_messages
set unb_sender_id = coalesce(unb_sender_id, sender_ediel_id),
    unb_sender_subaddress = coalesce(unb_sender_subaddress, sender_sub_address),
    unb_receiver_id = coalesce(unb_receiver_id, receiver_ediel_id),
    unb_receiver_subaddress = coalesce(unb_receiver_subaddress, receiver_sub_address),
    message_reference = coalesce(message_reference, original_message_id),
    bgm_code = coalesce(bgm_code, message_code),
    bgm_reference = coalesce(bgm_reference, external_reference),
    tenant_resolution_status = coalesce(tenant_resolution_status, case when company_id is null then 'tenant_unresolved' else 'tenant_resolved' end),
    business_match_status = coalesce(business_match_status, 'not_checked'),
    ack_status = coalesce(ack_status, coalesce(ack_outcome, 'pending')),
    processing_status = coalesce(processing_status, status)
where to_regclass('public.ediel_messages') is not null;

create index if not exists idx_ediel_messages_tenant_resolution
  on public.ediel_messages(environment, unb_receiver_id, unb_receiver_subaddress, application_reference, company_id, created_at desc);

create index if not exists idx_ediel_messages_company_refs
  on public.ediel_messages(company_id, direction, message_family, message_code, interchange_reference, bgm_reference, transaction_reference, external_reference);

create table if not exists public.ediel_business_references (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  source_message_id uuid references public.ediel_messages(id) on delete cascade,
  reference_type text not null,
  reference_value text not null,
  message_family text not null,
  message_code text,
  business_object_type text not null,
  business_object_id uuid not null,
  customer_id uuid references public.customers(id) on delete set null,
  customer_site_id uuid references public.customer_sites(id) on delete set null,
  metering_point_id uuid references public.metering_points(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ediel_business_references_company_ref
  on public.ediel_business_references(company_id, reference_type, reference_value);

create index if not exists idx_ediel_business_references_object
  on public.ediel_business_references(company_id, business_object_type, business_object_id);

create index if not exists idx_ediel_business_references_source
  on public.ediel_business_references(source_message_id);

create unique index if not exists ux_ediel_business_references_ref_object
  on public.ediel_business_references(company_id, reference_type, reference_value, business_object_type, business_object_id);

alter table if exists public.supplier_switch_requests
  add column if not exists customer_site_id uuid,
  add column if not exists grid_owner_ediel_id text,
  add column if not exists grid_area_code text,
  add column if not exists confirmed_start_date date,
  add column if not exists rff_li_reference text,
  add column if not exists outbound_z03_message_id uuid,
  add column if not exists inbound_z04_message_id uuid,
  add column if not exists rejection_reason_code text,
  add column if not exists rejection_reason_text text,
  add column if not exists created_at timestamptz not null default now();

update public.supplier_switch_requests
set customer_site_id = coalesce(customer_site_id, site_id),
    rff_li_reference = coalesce(rff_li_reference, external_reference)
where to_regclass('public.supplier_switch_requests') is not null;

create or replace view public.gridcore_ediel_duplicate_switch_rff_li_v
with (security_invoker = true)
as
select company_id, rff_li_reference, count(*) as duplicate_count, array_agg(id order by created_at, id) as row_ids
from public.supplier_switch_requests
where company_id is not null and rff_li_reference is not null
group by company_id, rff_li_reference
having count(*) > 1;

do $$
begin
  if not exists (select 1 from public.gridcore_ediel_duplicate_switch_rff_li_v) then
    create unique index if not exists ux_supplier_switch_requests_company_rff_li
      on public.supplier_switch_requests(company_id, rff_li_reference)
      where company_id is not null and rff_li_reference is not null;
  end if;
end $$;

create index if not exists idx_supplier_switch_requests_company_meter_status
  on public.supplier_switch_requests(company_id, metering_point_id, status, requested_start_date);

create table if not exists public.customer_supply_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  metering_point_id uuid not null references public.metering_points(id) on delete restrict,
  contract_id uuid,
  start_date date not null,
  end_date date,
  source text not null default 'manual',
  source_message_id uuid references public.ediel_messages(id) on delete set null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_supply_periods_valid_dates check (end_date is null or end_date >= start_date)
);

create index if not exists idx_customer_supply_periods_company_meter_period
  on public.customer_supply_periods(company_id, metering_point_id, start_date, end_date, status);

create index if not exists idx_customer_supply_periods_company_customer
  on public.customer_supply_periods(company_id, customer_id, status);

alter table if exists public.metering_permissions
  add column if not exists customer_site_id uuid,
  add column if not exists grid_owner_ediel_id text,
  add column if not exists permission_scope text,
  add column if not exists purpose_code text,
  add column if not exists product_code text,
  add column if not exists direction_code text,
  add column if not exists requested_from_date date,
  add column if not exists requested_to_date date,
  add column if not exists rff_li_reference text,
  add column if not exists permission_id text,
  add column if not exists outbound_z13_message_id uuid,
  add column if not exists inbound_z14_message_id uuid,
  add column if not exists inbound_z15_message_id uuid,
  add column if not exists outbound_z18_message_id uuid,
  add column if not exists created_at timestamptz not null default now();

update public.metering_permissions
set customer_site_id = coalesce(customer_site_id, site_id),
    rff_li_reference = coalesce(rff_li_reference, case_reference),
    permission_id = coalesce(permission_id, permission_reference),
    requested_from_date = coalesce(requested_from_date, requested_start_date),
    requested_to_date = coalesce(requested_to_date, requested_end_date),
    outbound_z13_message_id = coalesce(outbound_z13_message_id, source_z13_message_id),
    inbound_z14_message_id = coalesce(inbound_z14_message_id, source_z14_message_id)
where to_regclass('public.metering_permissions') is not null;

create or replace view public.gridcore_ediel_duplicate_permission_rff_li_v
with (security_invoker = true)
as
select company_id, rff_li_reference, count(*) as duplicate_count, array_agg(id order by created_at, id) as row_ids
from public.metering_permissions
where company_id is not null and rff_li_reference is not null
group by company_id, rff_li_reference
having count(*) > 1;

create or replace view public.gridcore_ediel_duplicate_permission_id_v
with (security_invoker = true)
as
select company_id, permission_id, count(*) as duplicate_count, array_agg(id order by created_at, id) as row_ids
from public.metering_permissions
where company_id is not null and permission_id is not null
group by company_id, permission_id
having count(*) > 1;

do $$
begin
  if not exists (select 1 from public.gridcore_ediel_duplicate_permission_rff_li_v) then
    create unique index if not exists ux_metering_permissions_company_rff_li
      on public.metering_permissions(company_id, rff_li_reference)
      where company_id is not null and rff_li_reference is not null;
  end if;

  if not exists (select 1 from public.gridcore_ediel_duplicate_permission_id_v) then
    create unique index if not exists ux_metering_permissions_company_permission_id
      on public.metering_permissions(company_id, permission_id)
      where company_id is not null and permission_id is not null;
  end if;
end $$;

create index if not exists idx_metering_permissions_company_meter_status
  on public.metering_permissions(company_id, metering_point_id, status);

alter table if exists public.metering_values
  add column if not exists customer_site_id uuid,
  add column if not exists source_message_id uuid,
  add column if not exists source_transaction_id text,
  add column if not exists grid_owner_ediel_id text,
  add column if not exists grid_area_code text,
  add column if not exists product_code text,
  add column if not exists register_code text,
  add column if not exists meter_number text,
  add column if not exists resolution text,
  add column if not exists quantity numeric,
  add column if not exists unit text,
  add column if not exists registration_time timestamptz,
  add column if not exists reason_code text,
  add column if not exists status text,
  add column if not exists created_at timestamptz not null default now();

update public.metering_values
set customer_site_id = coalesce(customer_site_id, site_id),
    source_message_id = coalesce(source_message_id, source_ediel_message_id),
    quantity = coalesce(quantity, value_kwh),
    unit = coalesce(unit, 'KWH'),
    registration_time = coalesce(registration_time, read_at),
    status = coalesce(status, value_status, 'current')
where to_regclass('public.metering_values') is not null;

create or replace view public.gridcore_ediel_duplicate_metering_values_v
with (security_invoker = true)
as
select
  company_id,
  metering_point_id,
  product_code,
  register_code,
  meter_number,
  period_start,
  period_end,
  reading_type,
  source_transaction_id,
  count(*) as duplicate_count,
  array_agg(id order by created_at, id) as row_ids
from public.metering_values
where company_id is not null
  and metering_point_id is not null
  and period_start is not null
  and period_end is not null
group by company_id, metering_point_id, product_code, register_code, meter_number, period_start, period_end, reading_type, source_transaction_id
having count(*) > 1;

do $$
begin
  if not exists (select 1 from public.gridcore_ediel_duplicate_metering_values_v) then
    create unique index if not exists ux_metering_values_company_ediel_duplicate_guard
      on public.metering_values(
        company_id,
        metering_point_id,
        coalesce(product_code, ''),
        coalesce(register_code, ''),
        coalesce(meter_number, ''),
        period_start,
        period_end,
        coalesce(reading_type, ''),
        coalesce(source_transaction_id, '')
      )
      where company_id is not null and metering_point_id is not null and period_start is not null and period_end is not null;
  end if;
end $$;

create index if not exists idx_metering_values_company_billing_status
  on public.metering_values(company_id, metering_point_id, period_start, period_end, status);

alter table if exists public.billing_underlays
  add column if not exists contract_id uuid,
  add column if not exists billing_period_start date,
  add column if not exists billing_period_end date,
  add column if not exists missing_values_count integer,
  add column if not exists source_meter_value_count integer,
  add column if not exists pricing_snapshot_id uuid,
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_billing_underlays_company_object_period
  on public.billing_underlays(company_id, customer_id, metering_point_id, billing_period_start, billing_period_end, status);

create table if not exists public.billing_underlay_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  billing_underlay_id uuid not null references public.billing_underlays(id) on delete cascade,
  meter_value_id uuid references public.metering_values(id) on delete restrict,
  period_start timestamptz not null,
  period_end timestamptz not null,
  quantity numeric not null,
  unit text not null,
  product_code text,
  register_code text,
  quality_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_underlay_items_company_underlay
  on public.billing_underlay_items(company_id, billing_underlay_id);

create index if not exists idx_billing_underlay_items_meter_value
  on public.billing_underlay_items(meter_value_id);

create table if not exists public.ediel_unresolved_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  source_message_id uuid references public.ediel_messages(id) on delete cascade,
  issue_type text not null,
  severity text not null default 'warning',
  extracted_identifiers jsonb not null default '{}'::jsonb,
  suggested_matches jsonb not null default '[]'::jsonb,
  status text not null default 'open',
  assigned_to uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ediel_unresolved_items_company_status
  on public.ediel_unresolved_items(company_id, status, created_at desc);

create index if not exists idx_ediel_unresolved_items_source
  on public.ediel_unresolved_items(source_message_id);

create table if not exists public.ediel_ack_chains (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  source_message_id uuid not null references public.ediel_messages(id) on delete cascade,
  ack_message_id uuid references public.ediel_messages(id) on delete set null,
  ack_family text not null,
  ack_scope text not null default 'message',
  transaction_reference text,
  outcome text not null,
  created_at timestamptz not null default now()
);

create or replace view public.gridcore_ediel_duplicate_ack_chains_v
with (security_invoker = true)
as
select company_id, source_message_id, ack_family, ack_scope, coalesce(transaction_reference, '') as transaction_reference_key, outcome, count(*) as duplicate_count, array_agg(id order by created_at, id) as row_ids
from public.ediel_ack_chains
group by company_id, source_message_id, ack_family, ack_scope, coalesce(transaction_reference, ''), outcome
having count(*) > 1;

do $$
begin
  if not exists (select 1 from public.gridcore_ediel_duplicate_ack_chains_v) then
    create unique index if not exists ux_ediel_ack_chains_dedupe
      on public.ediel_ack_chains(company_id, source_message_id, ack_family, ack_scope, coalesce(transaction_reference, ''), outcome);
  end if;
end $$;

create index if not exists idx_ediel_ack_chains_source
  on public.ediel_ack_chains(company_id, source_message_id, ack_family);

alter table if exists public.ediel_message_events
  add column if not exists message_id uuid,
  add column if not exists event_payload jsonb,
  add column if not exists company_id uuid,
  add column if not exists created_at timestamptz not null default now();

update public.ediel_message_events e
set message_id = coalesce(e.message_id, e.ediel_message_id),
    event_payload = coalesce(e.event_payload, e.payload),
    company_id = coalesce(e.company_id, m.company_id)
from public.ediel_messages m
where e.ediel_message_id = m.id;

create index if not exists idx_ediel_message_events_company_message
  on public.ediel_message_events(company_id, ediel_message_id, created_at desc);

alter table if exists public.ediel_message_rules
  add column if not exists environment text,
  add column if not exists version text,
  add column if not exists association_code text,
  add column if not exists rule_payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

update public.ediel_message_rules
set version = coalesce(version, version_code),
    rule_payload = coalesce(rule_payload, metadata, '{}'::jsonb)
where to_regclass('public.ediel_message_rules') is not null;

alter table if exists public.ediel_field_rules
  add column if not exists field_number text,
  add column if not exists code_list_name text,
  add column if not exists error_code text,
  add column if not exists ftx_code text,
  add column if not exists rule_payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

update public.ediel_field_rules
set error_code = coalesce(error_code, error_code_if_missing, error_code_if_invalid),
    rule_payload = coalesce(rule_payload, metadata, '{}'::jsonb)
where to_regclass('public.ediel_field_rules') is not null;

create table if not exists public.ediel_code_lists (
  id uuid primary key default gen_random_uuid(),
  code_list_name text not null,
  code text not null,
  label text,
  market text,
  valid_from date,
  valid_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists ux_ediel_code_lists_name_code_market
  on public.ediel_code_lists(code_list_name, code, coalesce(market, ''));

insert into public.ediel_code_lists(code_list_name, code, label, metadata)
select cr.code_list, value, value, jsonb_build_object('source_table', 'ediel_code_rules')
from public.ediel_code_rules cr
cross join lateral unnest(cr.allowed_values) as value
where to_regclass('public.ediel_code_rules') is not null
on conflict do nothing;

create table if not exists public.ediel_error_rules (
  id uuid primary key default gen_random_uuid(),
  message_family text not null,
  message_code text,
  error_key text not null,
  ack_family text not null,
  erc_code text,
  ftx_code text,
  default_text text,
  severity text not null default 'error',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ediel_error_rules
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists default_text text,
  add column if not exists severity text not null default 'error';

insert into public.ediel_error_rules(company_id, message_family, message_code, error_key, ack_family, erc_code, ftx_code, default_text, metadata)
select company_id, coalesce(message_family, 'OTHER'), message_code, error_key, 'APERAK', erc_code, ftx_code, ftx_text, metadata
from public.ediel_aperak_error_rules
where to_regclass('public.ediel_aperak_error_rules') is not null
on conflict do nothing;

create unique index if not exists ux_ediel_error_rules_key
  on public.ediel_error_rules(coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), message_family, coalesce(message_code, ''), error_key, ack_family);

create table if not exists public.ediel_version_rules (
  id uuid primary key default gen_random_uuid(),
  message_family text not null,
  message_code text,
  market text,
  version text not null,
  association_code text,
  valid_from date,
  valid_to date,
  is_current boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.ediel_version_rules(message_family, message_code, version, association_code, valid_from, valid_to, is_current, metadata)
select message_family, message_code, coalesce(version_code, version), association_code, valid_from, valid_to, coalesce(is_active, true), coalesce(rule_payload, metadata, '{}'::jsonb)
from public.ediel_message_rules
where to_regclass('public.ediel_message_rules') is not null
  and coalesce(version_code, version) is not null
on conflict do nothing;

create index if not exists idx_ediel_version_rules_lookup
  on public.ediel_version_rules(message_family, message_code, market, is_current, valid_from desc);

-- Safe foreign keys for newly added compatibility columns. NOT VALID avoids scanning or blocking existing dirty data.
do $$
begin
  if to_regclass('public.customer_sites') is not null and not exists (select 1 from pg_constraint where conname = 'customer_sites_customer_site_id_self_fk') then
    alter table public.customer_sites add constraint customer_sites_customer_site_id_self_fk foreign key (customer_site_id) references public.customer_sites(id) not valid;
  end if;
  if to_regclass('public.metering_points') is not null and not exists (select 1 from pg_constraint where conname = 'metering_points_customer_site_id_fk') then
    alter table public.metering_points add constraint metering_points_customer_site_id_fk foreign key (customer_site_id) references public.customer_sites(id) not valid;
  end if;
  if to_regclass('public.supplier_switch_requests') is not null and not exists (select 1 from pg_constraint where conname = 'supplier_switch_requests_customer_site_id_fk') then
    alter table public.supplier_switch_requests add constraint supplier_switch_requests_customer_site_id_fk foreign key (customer_site_id) references public.customer_sites(id) not valid;
  end if;
  if to_regclass('public.supplier_switch_requests') is not null and not exists (select 1 from pg_constraint where conname = 'supplier_switch_requests_outbound_z03_message_id_fk') then
    alter table public.supplier_switch_requests add constraint supplier_switch_requests_outbound_z03_message_id_fk foreign key (outbound_z03_message_id) references public.ediel_messages(id) not valid;
  end if;
  if to_regclass('public.supplier_switch_requests') is not null and not exists (select 1 from pg_constraint where conname = 'supplier_switch_requests_inbound_z04_message_id_fk') then
    alter table public.supplier_switch_requests add constraint supplier_switch_requests_inbound_z04_message_id_fk foreign key (inbound_z04_message_id) references public.ediel_messages(id) not valid;
  end if;
  if to_regclass('public.metering_permissions') is not null and not exists (select 1 from pg_constraint where conname = 'metering_permissions_customer_site_id_fk') then
    alter table public.metering_permissions add constraint metering_permissions_customer_site_id_fk foreign key (customer_site_id) references public.customer_sites(id) not valid;
  end if;
  if to_regclass('public.metering_values') is not null and not exists (select 1 from pg_constraint where conname = 'metering_values_customer_site_id_fk') then
    alter table public.metering_values add constraint metering_values_customer_site_id_fk foreign key (customer_site_id) references public.customer_sites(id) not valid;
  end if;
  if to_regclass('public.metering_values') is not null and not exists (select 1 from pg_constraint where conname = 'metering_values_source_message_id_fk') then
    alter table public.metering_values add constraint metering_values_source_message_id_fk foreign key (source_message_id) references public.ediel_messages(id) not valid;
  end if;
end $$;

-- RLS helper and policies. Prefer the existing Gridex helpers when present; otherwise fall back to memberships.
do $$
declare
  t text;
  read_expr text;
  write_expr text;
  tables text[] := array[
    'customers',
    'customer_sites',
    'metering_points',
    'customer_contracts',
    'supplier_switch_requests',
    'metering_permissions',
    'metering_values',
    'billing_underlays',
    'billing_underlay_items',
    'ediel_messages',
    'ediel_business_references',
    'ediel_unresolved_items',
    'ediel_message_events',
    'ediel_ack_chains',
    'customer_supply_periods'
  ];
begin
  if to_regprocedure('public.gridex_user_is_platform_admin()') is not null
     and to_regprocedure('public.gridex_can_read_company(uuid)') is not null
     and to_regprocedure('public.gridex_can_write_company(uuid)') is not null then
    read_expr := '(public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id)))';
    write_expr := '(public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_write_company(company_id)))';
  else
    read_expr := '(company_id is not null and company_id in (select cm.company_id from public.company_memberships cm where cm.user_id = auth.uid() and coalesce(cm.status, ''active'') = ''active'' and coalesce(cm.is_active, true) = true))';
    write_expr := read_expr;
  end if;

  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'gridcore_ediel_saas_select_' || t) then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', 'gridcore_ediel_saas_select_' || t, t, read_expr);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'gridcore_ediel_saas_insert_' || t) then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', 'gridcore_ediel_saas_insert_' || t, t, write_expr);
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'gridcore_ediel_saas_update_' || t) then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', 'gridcore_ediel_saas_update_' || t, t, read_expr, write_expr);
    end if;
  end loop;
end $$;

commit;
