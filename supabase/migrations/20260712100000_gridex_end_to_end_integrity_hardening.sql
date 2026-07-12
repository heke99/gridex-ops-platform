-- Gridex end-to-end integrity hardening.
-- Source of truth: customer site -> verified grid owner -> routed market message ->
-- canonical metering values -> supply-period-scoped billing underlay -> provider-confirmed invoice.
-- This migration intentionally fails on unsupported dirty states instead of silently skipping constraints.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Deployment/schema readiness and distributed automation locks
-- ---------------------------------------------------------------------------
create table if not exists public.platform_schema_state (
  id boolean primary key default true check (id),
  current_version text not null,
  is_ready boolean not null default false,
  blocking_issues jsonb not null default '[]'::jsonb,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_locks (
  lock_key text primary key,
  company_id uuid references public.companies(id) on delete cascade,
  lock_token uuid not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists automation_locks_company_expires_idx on public.automation_locks(company_id, expires_at);
alter table public.automation_locks enable row level security;
revoke all on public.automation_locks from public, anon, authenticated;
grant select, insert, update, delete on public.automation_locks to service_role;

create or replace function public.gridex_acquire_automation_lock(
  p_lock_key text,
  p_lock_token uuid,
  p_company_id uuid default null,
  p_ttl_seconds integer default 3600,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_expires timestamptz;
begin
  if nullif(btrim(p_lock_key), '') is null or p_lock_token is null then
    raise exception 'lock_key_and_token_required' using errcode = '22023';
  end if;
  if p_ttl_seconds < 30 or p_ttl_seconds > 86400 then
    raise exception 'lock_ttl_out_of_range' using errcode = '22023';
  end if;
  v_expires := v_now + make_interval(secs => p_ttl_seconds);

  delete from public.automation_locks where expires_at <= v_now;
  insert into public.automation_locks(lock_key, company_id, lock_token, locked_at, expires_at, metadata)
  values (btrim(p_lock_key), p_company_id, p_lock_token, v_now, v_expires, coalesce(p_metadata, '{}'::jsonb))
  on conflict (lock_key) do nothing;
  return found;
end;
$$;

create or replace function public.gridex_release_automation_lock(p_lock_key text, p_lock_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.automation_locks
   where lock_key = btrim(p_lock_key)
     and lock_token = p_lock_token;
  return found;
end;
$$;
revoke all on function public.gridex_acquire_automation_lock(text,uuid,uuid,integer,jsonb) from public, anon, authenticated;
revoke all on function public.gridex_release_automation_lock(text,uuid) from public, anon, authenticated;
grant execute on function public.gridex_acquire_automation_lock(text,uuid,uuid,integer,jsonb) to service_role;
grant execute on function public.gridex_release_automation_lock(text,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Explicit billing and outbound controls (never infer billing from Ediel)
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists billing_automation_enabled boolean not null default false,
  add column if not exists invoice_export_enabled boolean not null default false,
  add column if not exists invoice_export_target_system text,
  add column if not exists invoice_export_format text not null default 'json',
  add column if not exists outbound_frozen boolean not null default false,
  add column if not exists outbound_frozen_at timestamptz,
  add column if not exists outbound_freeze_reason text,
  add column if not exists outbound_frozen_channels text[] not null default '{}'::text[];

-- Conservative backfill: billing is never inferred from Ediel readiness.
-- Only tenants with an explicitly active production billing-provider connection
-- are enabled. All other tenants remain disabled until an administrator opts in.
update public.companies c
   set billing_automation_enabled = true,
       invoice_export_enabled = true,
       invoice_export_target_system = coalesce(c.invoice_export_target_system, p.provider)
  from public.billing_provider_connections p
 where p.company_id = c.id
   and p.environment = 'production'
   and p.status = 'active'
   and coalesce(c.is_active, true) = true
   and coalesce(c.status, 'active') = 'active';

alter table public.billing_automation_runs
  add column if not exists lock_key text,
  add column if not exists lock_token uuid,
  add column if not exists export_requested boolean not null default false,
  add column if not exists export_confirmed boolean not null default false;
create unique index if not exists billing_automation_one_running_period_uidx
  on public.billing_automation_runs(company_id, period_month)
  where status = 'running';

-- ---------------------------------------------------------------------------
-- 3. Canonical metering revision/billing state and dedupe dimensions
-- ---------------------------------------------------------------------------
alter table public.normalized_metering_values
  add column if not exists revision_status text not null default 'current',
  add column if not exists billing_status text not null default 'pending_match',
  add column if not exists register_code text,
  add column if not exists product_code text,
  add column if not exists direction text not null default 'consumption',
  add column if not exists unit text not null default 'kWh',
  add column if not exists canonical_dedupe_key text,
  add column if not exists replaced_by_value_id uuid,
  add column if not exists previous_value_id uuid,
  add column if not exists revision_number integer not null default 1,
  add column if not exists supply_period_id uuid,
  add column if not exists updated_at timestamptz not null default now();

update public.normalized_metering_values
   set revision_status = case when lower(coalesce(status, '')) in ('void','replaced','superseded') then lower(status) else 'current' end,
       billing_status = case when lower(coalesce(status, '')) in ('billable','ready','matched') then 'billable' else 'pending_match' end,
       unit = coalesce(nullif(unit, ''), 'kWh'),
       direction = coalesce(nullif(direction, ''), 'consumption'),
       canonical_dedupe_key = encode(digest(concat_ws('|', company_id::text, metering_point_id::text, period_start::text, period_end::text,
         coalesce(register_code,''), coalesce(product_code,''), coalesce(direction,'consumption'), coalesce(unit,'kWh')), 'sha256'), 'hex')
 where canonical_dedupe_key is null
    or canonical_dedupe_key = '';

-- Deterministically demote duplicate current revisions before the unique
-- canonical index is installed. The newest row remains current and older rows
-- retain a traceable replaced_by link instead of being deleted.
with ranked as (
  select id,
         first_value(id) over (
           partition by company_id,canonical_dedupe_key
           order by coalesce(updated_at,created_at) desc,created_at desc,id desc
         ) as winner_id,
         row_number() over (
           partition by company_id,canonical_dedupe_key
           order by coalesce(updated_at,created_at) desc,created_at desc,id desc
         ) as rn
    from public.normalized_metering_values
   where revision_status='current' and canonical_dedupe_key is not null
)
update public.normalized_metering_values n
   set revision_status='replaced',
       replaced_by_value_id=r.winner_id,
       updated_at=now()
  from ranked r
 where n.id=r.id and r.rn>1;

alter table public.normalized_metering_values drop constraint if exists normalized_metering_values_revision_status_check;
alter table public.normalized_metering_values add constraint normalized_metering_values_revision_status_check
  check (revision_status in ('current','replaced','superseded','void'));
alter table public.normalized_metering_values drop constraint if exists normalized_metering_values_billing_status_check;
alter table public.normalized_metering_values add constraint normalized_metering_values_billing_status_check
  check (billing_status in ('pending_match','billable','blocked','conflict','invoiced','credited'));
alter table public.normalized_metering_values drop constraint if exists normalized_metering_values_direction_check;
alter table public.normalized_metering_values add constraint normalized_metering_values_direction_check
  check (direction in ('consumption','production','net_consumption','net_production'));
alter table public.normalized_metering_values drop constraint if exists normalized_metering_values_unit_check;
alter table public.normalized_metering_values add constraint normalized_metering_values_unit_check
  check (unit in ('Wh','kWh','MWh'));
create unique index if not exists normalized_metering_values_current_canonical_uidx
  on public.normalized_metering_values(company_id, canonical_dedupe_key)
  where revision_status = 'current';
create index if not exists normalized_metering_values_billing_period_idx
  on public.normalized_metering_values(company_id, billing_status, revision_status, period_start, metering_point_id);

alter table public.metering_values
  add column if not exists revision_status text not null default 'current',
  add column if not exists billing_status text not null default 'pending_match',
  add column if not exists register_code text,
  add column if not exists product_code text,
  add column if not exists direction text not null default 'consumption',
  add column if not exists unit text not null default 'kWh';
update public.metering_values
   set revision_status = case when coalesce(is_current, true) = false or lower(coalesce(value_status,'')) in ('void','replaced','superseded') then 'replaced' else 'current' end,
       billing_status = case when lower(coalesce(value_status,'')) like 'billable%' then 'billable' else 'pending_match' end,
       unit = coalesce(nullif(unit,''), 'kWh'),
       direction = coalesce(nullif(direction,''), 'consumption');

alter table public.metering_values drop constraint if exists metering_values_revision_status_check;
alter table public.metering_values add constraint metering_values_revision_status_check
  check (revision_status in ('current','replaced','superseded','void'));
alter table public.metering_values drop constraint if exists metering_values_billing_status_check;
alter table public.metering_values add constraint metering_values_billing_status_check
  check (billing_status in ('pending_match','billable','blocked','conflict','invoiced','credited'));

-- ---------------------------------------------------------------------------
-- 4. Invoice provider idempotency and confirmation fields
-- ---------------------------------------------------------------------------
alter table public.invoice_export_items
  add column if not exists provider_request_id text,
  add column if not exists provider_confirmed_at timestamptz,
  add column if not exists reconciliation_status text not null default 'not_checked',
  add column if not exists last_reconciled_at timestamptz;
create unique index if not exists invoice_export_items_provider_request_uidx
  on public.invoice_export_items(company_id, provider, provider_request_id)
  where provider_request_id is not null;

alter table public.invoice_export_runs
  add column if not exists lock_token uuid,
  add column if not exists provider_confirmed_items integer not null default 0,
  add column if not exists reconciliation_status text not null default 'not_checked';

-- ---------------------------------------------------------------------------
-- 5. Address change invalidates all derived grid/routing context atomically
-- ---------------------------------------------------------------------------
create or replace function public.gridex_commit_customer_site_address(
  p_company_id uuid,
  p_customer_id uuid,
  p_site_id uuid,
  p_street text,
  p_postal_code text,
  p_city text,
  p_country text,
  p_care_of text,
  p_apartment_number text,
  p_address_normalized text,
  p_address_hash text,
  p_source text,
  p_source_reference text,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previous_hash text;
  v_address_id uuid;
  v_now timestamptz := now();
  v_address_changed boolean;
begin
  select address_hash into v_previous_hash
    from public.customer_sites
   where id = p_site_id and company_id = p_company_id and customer_id = p_customer_id
   for update;
  if not found then raise exception 'customer_site_not_found' using errcode = 'P0002'; end if;
  if nullif(btrim(p_address_hash), '') is null then raise exception 'address_hash_required' using errcode = '22023'; end if;
  v_address_changed := v_previous_hash is distinct from p_address_hash;

  if v_address_changed then
    update public.customer_operation_jobs
       set status = 'needs_review', stale_reason = 'site_address_changed_after_operation_started',
           last_error = 'Anläggningsadressen ändrades. Nätägar- och routinguppgifter har ogiltigförklarats.',
           completed_at = v_now, locked_at = null, locked_by = null, lock_token = null, updated_at = v_now
     where company_id = p_company_id and customer_site_id = p_site_id
       and status in ('queued','running','waiting_response');

    update public.customer_info_requests
       set status = 'manual_review_required', blocker_reason = 'Anläggningsadressen ändrades. Skapa en ny nätägarresolution och begäran.', updated_at = v_now
     where company_id = p_company_id and customer_id = p_customer_id and site_id = p_site_id
       and status in ('draft','ready_to_send','z01_prepared','waiting_for_z02','waiting_for_aperak','waiting_for_contrl');

    update public.grid_owner_information_requests
       set status = 'needs_review',
           last_error_code = 'site_address_changed',
           last_error_message = 'Begäran gäller en tidigare adress och får inte återanvändas.',
           metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('stale',true,'stale_at',v_now,'stale_reason','site_address_changed'),
           updated_at = v_now
     where company_id = p_company_id and customer_id = p_customer_id and customer_site_id = p_site_id
       and status in ('draft','ready_to_send','sent','waiting_response','blocked_missing_poa','blocked_missing_grid_owner_contact',
                      'blocked_missing_manual_mailbox','ready_to_send_manual_email','manual_email_queued','manual_email_sent','waiting_manual_response');

    update public.manual_email_outbox o
       set status = case when o.status in ('queued','sending') then 'failed' else o.status end,
           last_error = case when o.status in ('queued','sending') then 'Begäran ogiltigförklarades eftersom anläggningsadressen ändrades.' else o.last_error end,
           updated_at = v_now
      from public.grid_owner_information_requests r
     where o.request_id = r.id and r.company_id = p_company_id and r.customer_site_id = p_site_id
       and o.status in ('queued','sending');
  end if;

  update public.customer_sites
     set street = p_street, postal_code = p_postal_code, city = p_city, country = p_country,
         care_of = p_care_of, apartment_number = p_apartment_number,
         address_normalized = p_address_normalized, address_hash = p_address_hash,
         address_source = p_source, address_source_reference = p_source_reference,
         address_received_at = v_now,
         address_verified_at = case when p_source = 'grid_owner_response' then v_now else null end,
         address_verification_method = case when p_source = 'grid_owner_response' then 'grid_owner_response' else null end,
         address_confidence = case when p_source = 'grid_owner_response' then 1 else null end,
         address_status = case when p_source = 'grid_owner_response' then 'verified' else 'candidate' end,
         address_quality_status = 'complete', address_quality_warnings = '[]'::jsonb,
         -- Canonical grid context is always derived by the resolver or a verified
         -- grid-owner response. Claimed values remain evidence in metadata only.
         grid_owner_id = case when v_address_changed then null else grid_owner_id end,
         selected_grid_owner_id = case when v_address_changed then null else selected_grid_owner_id end,
         grid_area_code = case when v_address_changed then null else grid_area_code end,
         price_area_code = case when v_address_changed then null else price_area_code end,
         bidding_zone_code = case when v_address_changed then null else bidding_zone_code end,
         resolution_id = case when v_address_changed then null else resolution_id end,
         resolution_status = case when v_address_changed then 'pending_resolution' else resolution_status end,
         resolution_confidence = case when v_address_changed then null else resolution_confidence end,
         facility_data_status = case when p_source = 'grid_owner_response' then 'verified' when v_address_changed then 'unverified' else facility_data_status end,
         metadata = coalesce(metadata,'{}'::jsonb) || coalesce(p_metadata,'{}'::jsonb), updated_at = v_now
   where id = p_site_id and company_id = p_company_id and customer_id = p_customer_id;

  if v_address_changed then
    update public.metering_points
       set grid_owner_id = null, grid_area_code = null, price_area_code = null,
           verification_status = 'pending_verification', updated_at = v_now
     where company_id = p_company_id and (site_id = p_site_id or customer_site_id = p_site_id) and status <> 'closed';
  end if;

  select id into v_address_id from public.customer_addresses
   where company_id = p_company_id and customer_id = p_customer_id and type = 'facility'
     and metadata @> jsonb_build_object('customer_site_id', p_site_id)
   order by updated_at desc nulls last limit 1 for update;
  if v_address_id is null then
    insert into public.customer_addresses(company_id,customer_id,type,street_1,street_2,postal_code,city,country,is_active,metadata,created_at,updated_at)
    values(p_company_id,p_customer_id,'facility',p_street,p_care_of,p_postal_code,p_city,p_country,true,
      jsonb_build_object('customer_site_id',p_site_id,'address_hash',p_address_hash,'source',p_source),v_now,v_now);
  else
    update public.customer_addresses set street_1=p_street,street_2=p_care_of,postal_code=p_postal_code,city=p_city,country=p_country,
      is_active=true,metadata=jsonb_build_object('customer_site_id',p_site_id,'address_hash',p_address_hash,'source',p_source),updated_at=v_now
    where id=v_address_id;
  end if;

  insert into public.customer_site_address_history(company_id,customer_id,customer_site_id,address_hash,source,source_reference,actor_user_id,snapshot)
  values(p_company_id,p_customer_id,p_site_id,p_address_hash,p_source,p_source_reference,p_actor_user_id,
    jsonb_build_object('street',p_street,'postal_code',p_postal_code,'city',p_city,'country',p_country,'care_of',p_care_of,
      'apartment_number',p_apartment_number,'address_hash',p_address_hash,'source',p_source,'source_reference',p_source_reference,
      'claimed_grid_owner_id',p_metadata->>'claimed_grid_owner_id','claimed_grid_area_code',p_metadata->>'claimed_grid_area_code',
      'claimed_price_area_code',p_metadata->>'claimed_price_area_code','derived_context_invalidated',v_address_changed));
end;
$$;
revoke all on function public.gridex_commit_customer_site_address(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.gridex_commit_customer_site_address(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,jsonb,uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Strict tenant-consistency indexes used by composite foreign keys
-- ---------------------------------------------------------------------------
create unique index if not exists customers_company_id_id_uidx on public.customers(company_id,id);
create unique index if not exists customer_sites_company_id_id_uidx on public.customer_sites(company_id,id);
create unique index if not exists metering_points_company_id_id_uidx on public.metering_points(company_id,id);
create unique index if not exists customer_contracts_company_id_id_uidx on public.customer_contracts(company_id,id);

-- Fail deployment on cross-tenant relations instead of leaving them latent.
do $$
begin
  if exists (
    select 1 from public.customer_sites s join public.customers c on c.id=s.customer_id
    where s.company_id is distinct from c.company_id
  ) then raise exception 'cross_tenant_customer_site_rows_exist'; end if;
  if exists (
    select 1 from public.metering_points m join public.customers c on c.id=m.customer_id
    where m.company_id is distinct from c.company_id
  ) then raise exception 'cross_tenant_metering_point_customer_rows_exist'; end if;
  if exists (
    select 1 from public.metering_points m join public.customer_sites s on s.id=coalesce(m.customer_site_id,m.site_id)
    where m.company_id is distinct from s.company_id
  ) then raise exception 'cross_tenant_metering_point_site_rows_exist'; end if;
end $$;

-- Add validated composite FKs where the required columns exist.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='customer_sites_company_customer_fk') then
    alter table public.customer_sites add constraint customer_sites_company_customer_fk
      foreign key(company_id,customer_id) references public.customers(company_id,id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='metering_points_company_customer_fk') then
    alter table public.metering_points add constraint metering_points_company_customer_fk
      foreign key(company_id,customer_id) references public.customers(company_id,id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='metering_points_company_site_fk') then
    alter table public.metering_points add constraint metering_points_company_site_fk
      foreign key(company_id,site_id) references public.customer_sites(company_id,id);
  end if;
  if not exists (select 1 from pg_constraint where conname='metering_points_company_customer_site_fk') then
    alter table public.metering_points add constraint metering_points_company_customer_site_fk
      foreign key(company_id,customer_site_id) references public.customer_sites(company_id,id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Strict business-period and VAT constraints
-- ---------------------------------------------------------------------------
alter table public.billing_underlays drop constraint if exists billing_underlays_month_valid_check;
alter table public.billing_underlays add constraint billing_underlays_month_valid_check
  check (underlay_month between 1 and 12 and underlay_year between 2000 and 2100);
alter table public.invoice_export_runs drop constraint if exists invoice_export_runs_billing_month_valid_check;
alter table public.invoice_export_runs add constraint invoice_export_runs_billing_month_valid_check
  check (billing_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
alter table public.billing_automation_runs drop constraint if exists billing_automation_runs_period_month_chk;
alter table public.billing_automation_runs add constraint billing_automation_runs_period_month_chk
  check (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- ---------------------------------------------------------------------------
-- 8. Canonical metering backfill and supply-period assignment
-- ---------------------------------------------------------------------------
insert into public.normalized_metering_values(
  company_id,customer_id,customer_site_id,site_id,metering_point_id,facility_id,price_area,grid_area,
  period_start,period_end,resolution,quantity_kwh,quality_status,source_type,source_message_id,
  source_transaction_reference,source_line_reference,source_metering_value_id,raw_payload,status,
  revision_status,billing_status,register_code,product_code,direction,unit,canonical_dedupe_key,
  revision_number,created_at,created_by
)
select
  m.company_id,m.customer_id,m.customer_site_id,m.site_id,m.metering_point_id,
  coalesce(m.raw_payload->>'facility_id',m.raw_payload->>'site_facility_id'),
  case when coalesce(m.price_area,m.raw_payload->>'price_area',m.raw_payload->>'bidding_zone_code') in ('SE1','SE2','SE3','SE4')
       then coalesce(m.price_area,m.raw_payload->>'price_area',m.raw_payload->>'bidding_zone_code') end,
  coalesce(m.raw_payload->>'grid_area',m.raw_payload->>'grid_area_code'),
  m.period_start,m.period_end,coalesce(m.resolution,m.raw_payload->>'resolution'),m.value_kwh,m.quality_code,
  coalesce(nullif(m.source_system,''),'legacy_backfill'),m.source_ediel_message_id,
  coalesce(m.source_transaction_reference,m.raw_payload->>'source_transaction_reference'),
  coalesce(m.source_line_reference,m.raw_payload->>'source_line_reference'),m.id,coalesce(m.raw_payload,'{}'::jsonb),'stored',
  case when coalesce(m.is_current,true) then 'current' else 'replaced' end,
  coalesce(nullif(m.billing_status,''),'pending_match'),m.register_code,m.product_code,
  coalesce(nullif(m.direction,''),case when m.reading_type='production' then 'production' else 'consumption' end),
  coalesce(nullif(m.unit,''),'kWh'),
  encode(digest(concat_ws('|',m.company_id::text,m.metering_point_id::text,m.period_start::text,m.period_end::text,
    coalesce(m.register_code,''),coalesce(m.product_code,''),coalesce(nullif(m.direction,''),case when m.reading_type='production' then 'production' else 'consumption' end),coalesce(nullif(m.unit,''),'kWh')), 'sha256'),'hex'),
  coalesce(m.revision_number,1),coalesce(m.created_at,now()),m.created_by
from public.metering_values m
where m.company_id is not null and m.metering_point_id is not null and m.period_start is not null and m.period_end is not null
  and not exists (select 1 from public.normalized_metering_values n where n.source_metering_value_id=m.id)
on conflict do nothing;

-- Assign a supply period only when exactly one verified period covers the full interval.
with candidates as (
  select n.id, (array_agg(p.id order by p.id))[1] as period_id, count(*) as matches
  from public.normalized_metering_values n
  join public.customer_supply_periods p
    on p.company_id=n.company_id and p.metering_point_id=n.metering_point_id
   and p.status in ('active','confirmed_by_grid_owner')
   and p.start_date <= (n.period_start at time zone 'Europe/Stockholm')::date
   and (p.end_date is null or p.end_date >= ((n.period_end - interval '1 millisecond') at time zone 'Europe/Stockholm')::date)
  where n.revision_status='current'
  group by n.id
)
update public.normalized_metering_values n
   set supply_period_id=c.period_id,
       customer_id=p.customer_id,
       billing_status=case when c.matches=1 and p.contract_id is not null then 'billable' else 'conflict' end
  from candidates c
  join public.customer_supply_periods p on p.id=c.period_id
 where n.id=c.id;

update public.normalized_metering_values n
   set billing_status='blocked'
 where n.revision_status='current' and n.supply_period_id is null and n.billing_status not in ('invoiced','credited');

-- Atomic correction-aware ingestion writes the legacy compatibility row and
-- the canonical normalized row in one PostgreSQL transaction.
create or replace function public.gridex_ingest_metering_value_atomic(p_payload jsonb)
returns public.metering_values
language plpgsql
security definer
set search_path=public
as $$
declare
  v_company_id uuid := nullif(p_payload->>'company_id','')::uuid;
  v_customer_id uuid := nullif(p_payload->>'customer_id','')::uuid;
  v_site_id uuid := nullif(p_payload->>'site_id','')::uuid;
  v_customer_site_id uuid := nullif(p_payload->>'customer_site_id','')::uuid;
  v_metering_point_id uuid := nullif(p_payload->>'metering_point_id','')::uuid;
  v_key text := nullif(p_payload->>'canonical_dedupe_key','');
  v_existing public.metering_values%rowtype;
  v_inserted public.metering_values%rowtype;
  v_revision integer := 1;
  v_direction text := coalesce(nullif(p_payload->>'direction',''),case when p_payload->>'reading_type'='production' then 'production' else 'consumption' end);
  v_unit text := coalesce(nullif(p_payload->>'unit',''),'kWh');
  v_raw jsonb := coalesce(p_payload->'raw_payload','{}'::jsonb);
begin
  if v_company_id is null or v_customer_id is null or v_metering_point_id is null or v_key is null then
    raise exception 'metering_company_customer_point_key_required' using errcode='22023';
  end if;
  if not exists(select 1 from public.customers where company_id=v_company_id and id=v_customer_id) then
    raise exception 'metering_customer_tenant_mismatch' using errcode='23503';
  end if;
  if not exists(select 1 from public.metering_points where company_id=v_company_id and id=v_metering_point_id and customer_id=v_customer_id) then
    raise exception 'metering_point_tenant_or_customer_mismatch' using errcode='23503';
  end if;
  if (p_payload->>'period_start')::timestamptz >= (p_payload->>'period_end')::timestamptz then
    raise exception 'metering_period_invalid' using errcode='22023';
  end if;
  if v_direction not in ('consumption','production','net_consumption','net_production') then
    raise exception 'metering_direction_invalid' using errcode='22023';
  end if;
  if v_unit not in ('Wh','kWh','MWh') then raise exception 'metering_unit_invalid' using errcode='22023'; end if;

  select * into v_existing
    from public.metering_values
   where company_id=v_company_id and canonical_dedupe_key=v_key and is_current=true
   order by created_at desc,id desc limit 1 for update;

  if found and v_existing.value_kwh is not distinct from (p_payload->>'value_kwh')::numeric
           and v_existing.quality_code is not distinct from nullif(p_payload->>'quality_code','') then
    return v_existing;
  end if;

  if v_existing.id is not null then
    v_revision := coalesce(v_existing.revision_number,1)+1;
    update public.metering_values
       set is_current=false,value_status='replaced',revision_status='replaced',
           correction_reason=coalesce(nullif(p_payload->>'correction_reason',''),'Nytt mätvärde ersatte tidigare revision.')
     where id=v_existing.id and company_id=v_company_id;
    update public.normalized_metering_values
       set revision_status='replaced',status='replaced',updated_at=now()
     where company_id=v_company_id and source_metering_value_id=v_existing.id and revision_status='current';
  end if;

  insert into public.metering_values(
    company_id,customer_id,site_id,customer_site_id,metering_point_id,source_request_id,grid_owner_id,reading_type,
    value_kwh,quality_code,read_at,period_start,period_end,source_system,raw_payload,source_ediel_message_id,
    source_transaction_reference,source_line_reference,price_area,resolution,canonical_dedupe_key,is_current,previous_value_id,
    revision_number,correction_reason,value_status,revision_status,billing_status,register_code,product_code,direction,unit,created_by
  ) values (
    v_company_id,v_customer_id,v_site_id,v_customer_site_id,v_metering_point_id,nullif(p_payload->>'source_request_id','')::uuid,
    nullif(p_payload->>'grid_owner_id','')::uuid,coalesce(nullif(p_payload->>'reading_type',''),'consumption'),
    (p_payload->>'value_kwh')::numeric,nullif(p_payload->>'quality_code',''),(p_payload->>'read_at')::timestamptz,
    (p_payload->>'period_start')::timestamptz,(p_payload->>'period_end')::timestamptz,coalesce(nullif(p_payload->>'source_system',''),'grid_owner'),
    v_raw,nullif(p_payload->>'source_ediel_message_id','')::uuid,nullif(p_payload->>'source_transaction_reference',''),
    nullif(p_payload->>'source_line_reference',''),nullif(p_payload->>'price_area',''),nullif(p_payload->>'resolution',''),v_key,true,
    v_existing.id,v_revision,case when v_existing.id is null then null else coalesce(nullif(p_payload->>'correction_reason',''),'Korrigerat mätvärde.') end,
    'current','current','pending_match',nullif(p_payload->>'register_code',''),nullif(p_payload->>'product_code',''),v_direction,v_unit,
    nullif(p_payload->>'created_by','')::uuid
  ) returning * into v_inserted;

  if v_existing.id is not null then
    update public.metering_values set replaced_by_value_id=v_inserted.id where company_id=v_company_id and id=v_existing.id;
    update public.normalized_metering_values set replaced_by_value_id=v_inserted.id where company_id=v_company_id and source_metering_value_id=v_existing.id;
  end if;

  insert into public.normalized_metering_values(
    company_id,customer_id,customer_site_id,site_id,metering_point_id,facility_id,price_area,grid_area,period_start,period_end,
    resolution,quantity_kwh,quality_status,source_type,source_message_id,source_transaction_reference,source_line_reference,
    source_metering_value_id,raw_payload,status,revision_status,billing_status,register_code,product_code,direction,unit,
    canonical_dedupe_key,previous_value_id,revision_number,created_by
  ) values (
    v_company_id,v_customer_id,v_customer_site_id,v_site_id,v_metering_point_id,nullif(p_payload->>'facility_id',''),
    nullif(p_payload->>'price_area',''),nullif(p_payload->>'grid_area',''),(p_payload->>'period_start')::timestamptz,
    (p_payload->>'period_end')::timestamptz,nullif(p_payload->>'resolution',''),(p_payload->>'value_kwh')::numeric,
    nullif(p_payload->>'quality_code',''),coalesce(nullif(p_payload->>'source_system',''),'grid_owner'),
    nullif(p_payload->>'source_ediel_message_id','')::uuid,nullif(p_payload->>'source_transaction_reference',''),
    nullif(p_payload->>'source_line_reference',''),v_inserted.id,v_raw,'stored','current','pending_match',
    nullif(p_payload->>'register_code',''),nullif(p_payload->>'product_code',''),v_direction,v_unit,v_key,v_existing.id,v_revision,
    nullif(p_payload->>'created_by','')::uuid
  );

  return v_inserted;
end;
$$;
revoke all on function public.gridex_ingest_metering_value_atomic(jsonb) from public,anon,authenticated;
grant execute on function public.gridex_ingest_metering_value_atomic(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Supply-period segmented, transactional billing underlays
-- ---------------------------------------------------------------------------
alter table public.billing_underlays
  add column if not exists supply_period_id uuid,
  add column if not exists billing_block_reason text;

update public.billing_underlays
   set billing_period_start=coalesce(billing_period_start,(make_date(underlay_year,underlay_month,1)::timestamp at time zone 'Europe/Stockholm')),
       billing_period_end=coalesce(billing_period_end,((make_date(underlay_year,underlay_month,1)+interval '1 month')::timestamp at time zone 'Europe/Stockholm'))
 where underlay_year between 2000 and 2100 and underlay_month between 1 and 12;

-- Existing month-only rows cannot safely coexist with segmented rows. Keep the
-- latest row per exact segment and fail if duplicate economic rows remain.
drop index if exists public.ux_billing_underlays_company_customer_point_month;
create unique index if not exists billing_underlays_company_segment_uidx
  on public.billing_underlays(company_id,customer_id,metering_point_id,underlay_year,underlay_month,billing_period_start,billing_period_end);
create index if not exists billing_underlays_supply_period_idx
  on public.billing_underlays(company_id,supply_period_id,underlay_year,underlay_month,readiness_status);

create or replace function public.gridex_store_billing_underlay(
  p_company_id uuid,
  p_underlay jsonb,
  p_items jsonb,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_customer_id uuid := nullif(p_underlay->>'customer_id','')::uuid;
  v_metering_point_id uuid := nullif(p_underlay->>'metering_point_id','')::uuid;
  v_year integer := (p_underlay->>'underlay_year')::integer;
  v_month integer := (p_underlay->>'underlay_month')::integer;
  v_start timestamptz := (p_underlay->>'billing_period_start')::timestamptz;
  v_end timestamptz := (p_underlay->>'billing_period_end')::timestamptz;
begin
  if p_company_id is null or v_customer_id is null or v_metering_point_id is null then
    raise exception 'billing_underlay_tenant_customer_meter_required' using errcode='22023';
  end if;
  if v_end <= v_start then raise exception 'billing_underlay_invalid_segment' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then raise exception 'billing_underlay_items_must_be_array' using errcode='22023'; end if;
  if not exists(select 1 from public.customers where company_id=p_company_id and id=v_customer_id) then
    raise exception 'billing_underlay_customer_tenant_mismatch' using errcode='23503';
  end if;
  if not exists(select 1 from public.metering_points where company_id=p_company_id and id=v_metering_point_id) then
    raise exception 'billing_underlay_meter_tenant_mismatch' using errcode='23503';
  end if;

  insert into public.billing_underlays(
    company_id,customer_id,site_id,customer_site_id,metering_point_id,supply_period_id,contract_id,pricing_snapshot_id,
    price_plan_id,price_plan_version_id,price_book_id,contract_price_snapshot_id,billing_block_reason,campaign_id,price_area,
    underlay_month,underlay_year,billing_period_start,billing_period_end,status,readiness_status,readiness_issues,total_kwh,currency,
    source_system,source_meter_value_count,missing_values_count,payload,pricing_snapshot,received_at,validated_at,created_by,updated_by,updated_at
  ) values (
    p_company_id,v_customer_id,nullif(p_underlay->>'site_id','')::uuid,nullif(p_underlay->>'customer_site_id','')::uuid,v_metering_point_id,
    nullif(p_underlay->>'supply_period_id','')::uuid,nullif(p_underlay->>'contract_id','')::uuid,nullif(p_underlay->>'pricing_snapshot_id','')::uuid,
    nullif(p_underlay->>'price_plan_id','')::uuid,nullif(p_underlay->>'price_plan_version_id','')::uuid,nullif(p_underlay->>'price_book_id','')::uuid,
    nullif(p_underlay->>'contract_price_snapshot_id','')::uuid,nullif(p_underlay->>'billing_block_reason',''),nullif(p_underlay->>'campaign_id','')::uuid,
    nullif(p_underlay->>'price_area',''),v_month,v_year,v_start,v_end,coalesce(nullif(p_underlay->>'status',''),'pending'),
    coalesce(nullif(p_underlay->>'readiness_status',''),'blocked'),coalesce(p_underlay->'readiness_issues','[]'::jsonb),
    (p_underlay->>'total_kwh')::numeric,coalesce(nullif(p_underlay->>'currency',''),'SEK'),
    coalesce(nullif(p_underlay->>'source_system',''),'normalized_metering_values'),coalesce((p_underlay->>'source_meter_value_count')::integer,0),
    coalesce((p_underlay->>'missing_values_count')::integer,0),coalesce(p_underlay->'payload','{}'::jsonb),coalesce(p_underlay->'pricing_snapshot','{}'::jsonb),
    coalesce((p_underlay->>'received_at')::timestamptz,now()),nullif(p_underlay->>'validated_at','')::timestamptz,p_actor_user_id,p_actor_user_id,now()
  )
  on conflict(company_id,customer_id,metering_point_id,underlay_year,underlay_month,billing_period_start,billing_period_end)
  do update set
    site_id=excluded.site_id,customer_site_id=excluded.customer_site_id,supply_period_id=excluded.supply_period_id,contract_id=excluded.contract_id,
    pricing_snapshot_id=excluded.pricing_snapshot_id,price_plan_id=excluded.price_plan_id,price_plan_version_id=excluded.price_plan_version_id,
    price_book_id=excluded.price_book_id,contract_price_snapshot_id=excluded.contract_price_snapshot_id,billing_block_reason=excluded.billing_block_reason,
    campaign_id=excluded.campaign_id,price_area=excluded.price_area,status=excluded.status,readiness_status=excluded.readiness_status,
    readiness_issues=excluded.readiness_issues,total_kwh=excluded.total_kwh,currency=excluded.currency,source_system=excluded.source_system,
    source_meter_value_count=excluded.source_meter_value_count,missing_values_count=excluded.missing_values_count,payload=excluded.payload,
    pricing_snapshot=excluded.pricing_snapshot,received_at=excluded.received_at,validated_at=excluded.validated_at,updated_by=p_actor_user_id,updated_at=now()
  returning id into v_id;

  delete from public.billing_underlay_items where company_id=p_company_id and billing_underlay_id=v_id;
  insert into public.billing_underlay_items
  select (jsonb_populate_record(null::public.billing_underlay_items,
    item || jsonb_build_object('id',gen_random_uuid(),'company_id',p_company_id,'billing_underlay_id',v_id,
      'created_at',now(),'updated_at',now()))).* 
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) item;

  insert into public.billing_underlay_events(company_id,billing_underlay_id,event_type,message,metadata,created_by)
  values(p_company_id,v_id,'underlay_generated',case when p_underlay->>'readiness_status'='ready' then 'Fakturaunderlag är redo för prisberäkning.' else 'Fakturaunderlag är blockerat.' end,
    jsonb_build_object('billing_period_start',v_start,'billing_period_end',v_end,'source_rows',jsonb_array_length(coalesce(p_items,'[]'::jsonb))),p_actor_user_id);
  return v_id;
end;
$$;
revoke all on function public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.gridex_store_billing_underlay(uuid,jsonb,jsonb,uuid) to service_role;


-- ---------------------------------------------------------------------------
-- 10. Manual grid-owner request/outbox integrity
-- ---------------------------------------------------------------------------
alter table public.grid_owner_information_requests
  add column if not exists site_address_hash text,
  add column if not exists recipient_contact_channel_id uuid,
  add column if not exists recipient_verified_at timestamptz;

update public.grid_owner_information_requests r
   set site_address_hash = coalesce(
     nullif(r.metadata->>'site_address_hash',''),
     nullif(s.address_hash,''),
     encode(digest(concat_ws('|', lower(coalesce(s.street,'')), lower(coalesce(s.care_of,'')),
       regexp_replace(coalesce(s.postal_code,''),'\s','','g'), lower(coalesce(s.city,'')), lower(coalesce(s.country,'SE'))), 'sha256'),'hex')
   )
  from public.customer_sites s
 where r.customer_site_id=s.id and r.company_id=s.company_id and r.site_address_hash is null;

-- Old open manual rows without enough address context are not safe to reuse.
update public.grid_owner_information_requests
   set status='needs_review', last_error_code='site_address_hash_missing',
       last_error_message='Adressversion saknas. Skapa en ny verifierad nätägarbegäran.', updated_at=now()
 where channel='manual_email'
   and status in ('draft','ready_to_send','ready_to_send_manual_email','manual_email_queued','manual_email_sent','waiting_manual_response')
   and site_address_hash is null;

-- Manual and Ediel conversations have different idempotency dimensions.
drop index if exists public.grid_owner_information_requests_open_uidx;
create unique index if not exists grid_owner_information_requests_manual_open_uidx
  on public.grid_owner_information_requests(company_id,customer_site_id,request_type,grid_owner_id,site_address_hash)
  where channel='manual_email' and status in (
    'draft','ready_to_send','ready_to_send_manual_email','manual_email_queued','manual_email_sent',
    'waiting_manual_response','manual_response_received','needs_review','blocked_missing_poa',
    'blocked_missing_grid_owner_contact','blocked_missing_manual_mailbox'
  );
create unique index if not exists grid_owner_information_requests_market_open_uidx
  on public.grid_owner_information_requests(company_id,customer_site_id,request_type)
  where channel<>'manual_email' and status in ('draft','ready_to_send','sent','waiting_response','needs_review');

alter table public.manual_email_outbox
  add column if not exists actual_recipient_email text,
  add column if not exists external_delivery boolean not null default false,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists provider_idempotency_key text;
update public.manual_email_outbox
   set actual_recipient_email=coalesce(actual_recipient_email,to_email),
       external_delivery=case
         when coalesce(recipient_resolution->>'externally_sendable','false')::boolean
              and coalesce(recipient_resolution->>'selected_to_email',to_email)=to_email then true
         else false end,
       next_attempt_at=coalesce(next_attempt_at,queued_at,created_at,now()),
       provider_idempotency_key=coalesce(provider_idempotency_key,idempotency_key);

-- Previously queued rows with no verifiable external recipient are frozen.
update public.manual_email_outbox
   set status='failed', delivery_status='failed', last_error_code='recipient_resolution_not_external',
       last_error='Migrationen stoppade ett osäkert mottagarval.', updated_at=now()
 where status='queued' and external_delivery=false;

alter table public.manual_email_outbox drop constraint if exists manual_email_outbox_external_recipient_check;
alter table public.manual_email_outbox add constraint manual_email_outbox_external_recipient_check
  check (external_delivery=false or (actual_recipient_email is not null and lower(actual_recipient_email)=lower(to_email)));
create index if not exists manual_email_outbox_due_idx
  on public.manual_email_outbox(company_id,status,next_attempt_at,queued_at)
  where status='queued' and external_delivery=true;
create unique index if not exists manual_email_outbox_provider_idempotency_uidx
  on public.manual_email_outbox(provider,provider_idempotency_key)
  where provider_idempotency_key is not null;
drop index if exists public.manual_inbound_provider_message_uidx;
drop index if exists public.manual_inbound_messages_provider_message_uidx;
create unique index if not exists manual_inbound_provider_message_uidx
  on public.manual_inbound_messages(coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(mailbox,''),provider_message_id)
  where provider_message_id is not null;

alter table public.manual_communication_mailboxes add column if not exists verified_at timestamptz;
update public.manual_communication_mailboxes
   set verified_at=coalesce(verified_at,updated_at,created_at)
 where is_verified=true and verified_at is null;

-- Contact/mailbox lookups are deterministic and verified-only in production.
create index if not exists grid_owner_contact_channels_verified_lookup_idx
  on public.grid_owner_contact_channels(grid_owner_id,channel_type,company_id,verified_at desc,id)
  where is_enabled=true and is_verified=true and email is not null;
create index if not exists manual_communication_mailboxes_verified_lookup_idx
  on public.manual_communication_mailboxes(environment,mailbox_type,company_id,verified_at desc,id)
  where is_active=true and is_verified=true;

-- Composite tenant keys for critical service-role mutations.
create unique index if not exists grid_owner_information_requests_company_id_id_uidx
  on public.grid_owner_information_requests(company_id,id);
create unique index if not exists manual_email_outbox_company_id_id_uidx
  on public.manual_email_outbox(company_id,id);

do $$
begin
  if exists (
    select 1 from public.grid_owner_information_requests r
    join public.customer_sites s on s.id=r.customer_site_id
    where r.company_id is distinct from s.company_id
  ) then raise exception 'cross_tenant_grid_owner_request_site_rows_exist'; end if;
  if exists (
    select 1 from public.manual_email_outbox o
    join public.grid_owner_information_requests r on r.id=o.request_id
    where o.company_id is distinct from r.company_id
  ) then raise exception 'cross_tenant_manual_email_request_rows_exist'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Provider-confirmed invoice identity and VAT/currency invariants
-- ---------------------------------------------------------------------------
alter table public.invoice_export_items
  add column if not exists provider_idempotency_key text,
  add column if not exists provider_invoice_id text,
  add column if not exists provider_confirmed_at timestamptz,
  add column if not exists provider_reconciliation_status text not null default 'pending',
  add column if not exists provider_purchase_confirmed_at timestamptz,
  add column if not exists provider_delivery_uncertain boolean not null default false;
create unique index if not exists invoice_export_items_provider_idempotency_uidx
  on public.invoice_export_items(company_id,provider,provider_idempotency_key)
  where provider_idempotency_key is not null;
create unique index if not exists invoice_export_items_provider_invoice_uidx
  on public.invoice_export_items(company_id,provider,provider_invoice_id)
  where provider_invoice_id is not null;

-- VAT is stored as a decimal fraction, never as percentage points.
alter table public.billing_underlays add column if not exists vat_rate numeric default 0.25;
update public.billing_underlays
   set vat_rate=vat_rate/100
 where vat_rate > 1 and vat_rate <= 100;
alter table public.billing_underlays drop constraint if exists billing_underlays_vat_rate_fraction_check;
alter table public.billing_underlays add constraint billing_underlays_vat_rate_fraction_check
  check (vat_rate is null or (vat_rate >= 0 and vat_rate <= 1));

-- ---------------------------------------------------------------------------
-- 12. Cross-tenant relations for billing source-of-truth
-- ---------------------------------------------------------------------------
create unique index if not exists normalized_metering_values_company_id_id_uidx
  on public.normalized_metering_values(company_id,id);
create unique index if not exists customer_supply_periods_company_id_id_uidx
  on public.customer_supply_periods(company_id,id);
create unique index if not exists billing_underlays_company_id_id_uidx
  on public.billing_underlays(company_id,id);

do $$
begin
  if exists (
    select 1 from public.normalized_metering_values n
    join public.metering_points m on m.id=n.metering_point_id
    where n.company_id is distinct from m.company_id
  ) then raise exception 'cross_tenant_normalized_metering_point_rows_exist'; end if;
  if exists (
    select 1 from public.billing_underlays b
    join public.customers c on c.id=b.customer_id
    where b.company_id is distinct from c.company_id
  ) then raise exception 'cross_tenant_billing_underlay_customer_rows_exist'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- 13. Outbound freeze after restore/replay
-- ---------------------------------------------------------------------------
create table if not exists public.platform_outbound_state (
  id boolean primary key default true check(id),
  globally_frozen boolean not null default true,
  frozen_channels text[] not null default '{}'::text[],
  freeze_reason text not null default 'Ny migration/restore kräver manuell reconciliation före externa utskick.',
  frozen_at timestamptz not null default now(),
  unfrozen_at timestamptz,
  unfrozen_by uuid,
  updated_at timestamptz not null default now()
);
insert into public.platform_outbound_state(id,globally_frozen,freeze_reason)
values(true,true,'20260712100000 installerad: verifiera backfill och providerreconciliation innan externa utskick.')
on conflict(id) do update set globally_frozen=true,freeze_reason=excluded.freeze_reason,frozen_at=now(),unfrozen_at=null,unfrozen_by=null,updated_at=now();
alter table public.companies drop constraint if exists companies_outbound_frozen_channels_check;
alter table public.companies add constraint companies_outbound_frozen_channels_check
  check (outbound_frozen_channels <@ array['ediel','manual_email','customer_email','invoice_export','webhook']::text[]);
alter table public.platform_outbound_state drop constraint if exists platform_outbound_frozen_channels_check;
alter table public.platform_outbound_state add constraint platform_outbound_frozen_channels_check
  check (frozen_channels <@ array['ediel','manual_email','customer_email','invoice_export','webhook']::text[]);
alter table public.platform_outbound_state enable row level security;
revoke all on public.platform_outbound_state from public,anon,authenticated;
grant select,update on public.platform_outbound_state to service_role;

-- ---------------------------------------------------------------------------
-- 15. Atomic API rate limiting (fail-closed in runtime)
-- ---------------------------------------------------------------------------
create table if not exists public.integration_api_rate_limit_buckets (
  api_client_id uuid not null,
  company_id uuid not null,
  bucket_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (api_client_id,bucket_start)
);
create index if not exists integration_api_rate_limit_buckets_cleanup_idx
  on public.integration_api_rate_limit_buckets(bucket_start);
alter table public.integration_api_rate_limit_buckets enable row level security;
revoke all on public.integration_api_rate_limit_buckets from public,anon,authenticated;

create or replace function public.gridex_consume_api_rate_limit(
  p_api_client_id uuid,
  p_company_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_bucket timestamptz := date_trunc('minute',clock_timestamp());
  v_count integer;
begin
  if p_api_client_id is null or p_company_id is null or p_limit is null or p_limit <= 0 then
    raise exception 'invalid_rate_limit_arguments' using errcode='22023';
  end if;
  if not exists(select 1 from public.integration_api_clients where id=p_api_client_id and company_id=p_company_id and status='active') then
    raise exception 'api_client_tenant_mismatch' using errcode='42501';
  end if;
  insert into public.integration_api_rate_limit_buckets(api_client_id,company_id,bucket_start,request_count,updated_at)
  values(p_api_client_id,p_company_id,v_bucket,1,clock_timestamp())
  on conflict(api_client_id,bucket_start)
  do update set request_count=public.integration_api_rate_limit_buckets.request_count+1,
                company_id=excluded.company_id,
                updated_at=clock_timestamp()
  returning request_count into v_count;
  delete from public.integration_api_rate_limit_buckets where bucket_start < clock_timestamp()-interval '2 hours';
  return jsonb_build_object('allowed',v_count<=p_limit,'request_count',v_count,'limit',p_limit,'bucket_start',v_bucket);
end;
$$;
revoke all on function public.gridex_consume_api_rate_limit(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.gridex_consume_api_rate_limit(uuid,uuid,integer) to service_role;

-- ---------------------------------------------------------------------------
-- 16. Idempotency for every customer-portal write endpoint
-- ---------------------------------------------------------------------------
create table if not exists public.customer_portal_write_idempotency (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  api_client_id uuid not null references public.integration_api_clients(id) on delete cascade,
  route text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null check(status in ('processing','completed','failed')),
  response_status integer,
  response_body jsonb,
  error_code text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,api_client_id,route,idempotency_key)
);
create index if not exists customer_portal_write_idempotency_cleanup_idx
  on public.customer_portal_write_idempotency(company_id,created_at);
alter table public.customer_portal_write_idempotency enable row level security;
revoke all on public.customer_portal_write_idempotency from public,anon,authenticated;
grant select,insert,update on public.customer_portal_write_idempotency to service_role;

-- ---------------------------------------------------------------------------
-- 17. Tenant-safe provider webhook processing and reconciliation
-- ---------------------------------------------------------------------------
alter table public.invoice_provider_events
  add column if not exists processing_token uuid,
  add column if not exists processing_started_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists failure_reason text;

alter table public.invoice_provider_events drop constraint if exists invoice_provider_events_status_check;
alter table public.invoice_provider_events add constraint invoice_provider_events_status_check
  check (status in ('received','processing','processed','needs_review','failed','dead_letter'));
alter table public.invoice_provider_events drop constraint if exists invoice_provider_events_attempt_count_check;
alter table public.invoice_provider_events add constraint invoice_provider_events_attempt_count_check
  check (attempt_count >= 0);

create unique index if not exists invoice_provider_events_company_id_id_uidx
  on public.invoice_provider_events(company_id,id);
create unique index if not exists invoice_export_items_company_id_id_uidx
  on public.invoice_export_items(company_id,id);
create index if not exists invoice_provider_events_claim_idx
  on public.invoice_provider_events(company_id,status,received_at,id)
  where status in ('received','needs_review','failed','processing');

-- Existing rows without tenant identity are not safe to automate.
update public.invoice_provider_events e
   set company_id=i.company_id,
       matched_invoice_export_item_id=i.id
  from public.invoice_export_items i
 where e.company_id is null
   and e.matched_invoice_export_item_id=i.id;
update public.invoice_provider_events
   set status='needs_review',
       failure_reason=coalesce(failure_reason,'tenant_identity_missing')
 where company_id is null and status in ('received','processing');

create or replace function public.gridex_claim_invoice_provider_events(
  p_company_id uuid,
  p_statuses text[],
  p_limit integer,
  p_processing_token uuid,
  p_max_age_days integer default 365
) returns setof public.invoice_provider_events
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_processing_token is null or p_statuses is null or coalesce(array_length(p_statuses,1),0)=0
     or p_limit is null or p_limit < 1 or p_limit > 500
     or p_max_age_days is null or p_max_age_days < 1 or p_max_age_days > 3650 then
    raise exception 'invalid_provider_event_claim_arguments' using errcode='22023';
  end if;
  if exists(select 1 from unnest(p_statuses) s where s not in ('received','needs_review','failed')) then
    raise exception 'invalid_provider_event_claim_status' using errcode='22023';
  end if;

  return query
  with candidates as (
    select e.id
      from public.invoice_provider_events e
     where e.company_id is not null
       and (p_company_id is null or e.company_id=p_company_id)
       and e.received_at >= clock_timestamp()-(p_max_age_days::text||' days')::interval
       and (
         e.status=any(p_statuses)
         or (e.status='processing' and e.processing_started_at < clock_timestamp()-interval '15 minutes')
       )
     order by e.received_at,e.id
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.invoice_provider_events e
       set status='processing',
           processing_token=p_processing_token,
           processing_started_at=clock_timestamp(),
           attempt_count=coalesce(e.attempt_count,0)+1,
           failure_reason=null
      from candidates c
     where e.id=c.id
     returning e.*
  )
  select * from claimed;
end;
$$;
revoke all on function public.gridex_claim_invoice_provider_events(uuid,text[],integer,uuid,integer) from public,anon,authenticated;
grant execute on function public.gridex_claim_invoice_provider_events(uuid,text[],integer,uuid,integer) to service_role;

-- Provider events and portal invoices must resolve inside one tenant.
do $$
begin
  if exists (
    select 1 from public.invoice_provider_events e
    join public.invoice_export_items i on i.id=e.matched_invoice_export_item_id
    where e.company_id is not null and e.company_id is distinct from i.company_id
  ) then raise exception 'cross_tenant_invoice_provider_events_exist'; end if;
end $$;

alter table public.invoice_provider_events drop constraint if exists invoice_provider_events_company_item_fkey;
alter table public.invoice_provider_events
  add constraint invoice_provider_events_company_item_fkey
  foreign key(company_id,matched_invoice_export_item_id)
  references public.invoice_export_items(company_id,id);

create unique index if not exists customer_invoices_company_partner_ref_uidx
  on public.customer_invoices(company_id,partner_invoice_reference)
  where partner_invoice_reference is not null;

-- API client identity is tenant scoped, not merely globally addressable by UUID.
create unique index if not exists integration_api_clients_company_id_id_uidx
  on public.integration_api_clients(company_id,id);
do $$
begin
  if exists (
    select 1 from public.customer_portal_write_idempotency w
    join public.integration_api_clients c on c.id=w.api_client_id
    where w.company_id is distinct from c.company_id
  ) then raise exception 'cross_tenant_customer_portal_idempotency_rows_exist'; end if;
end $$;
alter table public.customer_portal_write_idempotency drop constraint if exists customer_portal_write_idempotency_api_client_id_fkey;
alter table public.customer_portal_write_idempotency drop constraint if exists customer_portal_write_idempotency_company_client_fkey;
alter table public.customer_portal_write_idempotency
  add constraint customer_portal_write_idempotency_company_client_fkey
  foreign key(company_id,api_client_id)
  references public.integration_api_clients(company_id,id)
  on delete cascade;

-- Idempotency keys are tenant scoped even when two tenants use the same provider.
drop index if exists public.manual_email_outbox_provider_idempotency_uidx;
create unique index manual_email_outbox_provider_idempotency_uidx
  on public.manual_email_outbox(company_id,provider,provider_idempotency_key)
  where provider_idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 18. Composite tenant integrity across the customer-to-invoice chain
-- ---------------------------------------------------------------------------
create unique index if not exists pricing_runs_company_id_id_uidx on public.pricing_runs(company_id,id);
create unique index if not exists grid_owner_information_requests_company_id_id_uidx on public.grid_owner_information_requests(company_id,id);
create unique index if not exists customer_invoices_company_id_id_uidx on public.customer_invoices(company_id,id);
create unique index if not exists normalized_metering_values_company_id_id_uidx on public.normalized_metering_values(company_id,id);
create unique index if not exists billing_underlays_company_id_id_uidx on public.billing_underlays(company_id,id);

-- Deterministic company backfills. Ambiguous rows remain null and block below.
update public.billing_underlays b
   set company_id=c.company_id
  from public.customers c
 where b.company_id is null and b.customer_id=c.id;
update public.grid_owner_information_requests r
   set company_id=c.company_id
  from public.customers c
 where r.company_id is null and r.customer_id=c.id;
update public.manual_inbound_messages m
   set company_id=r.company_id
  from public.grid_owner_information_requests r
 where m.company_id is null and m.request_id=r.id;
update public.customer_invoices i
   set company_id=c.company_id
  from public.customers c
 where i.company_id is null and i.customer_id=c.id;
update public.customer_invoices i
   set company_id=b.company_id
  from public.billing_underlays b
 where i.company_id is null and i.billing_underlay_id=b.id;

-- Fail before constraints if any relation crosses a tenant boundary.
do $$
begin
  if exists(select 1 from public.customer_contracts x join public.customers c on c.id=x.customer_id where x.company_id is distinct from c.company_id)
    then raise exception 'cross_tenant_contract_customer_rows_exist'; end if;
  if exists(select 1 from public.customer_contracts x join public.customer_sites s on s.id=coalesce(x.customer_site_id,x.site_id) where x.company_id is distinct from s.company_id)
    then raise exception 'cross_tenant_contract_site_rows_exist'; end if;
  if exists(select 1 from public.customer_contracts x join public.customer_sites s on s.id=x.site_id where x.company_id is distinct from s.company_id)
    then raise exception 'cross_tenant_contract_site_alias_rows_exist'; end if;
  if exists(select 1 from public.metering_points x join public.customer_sites s on s.id=x.site_id where x.company_id is distinct from s.company_id)
    then raise exception 'cross_tenant_metering_point_site_alias_rows_exist'; end if;
  if exists(select 1 from public.metering_points x join public.customer_sites s on s.id=x.customer_site_id where x.company_id is distinct from s.company_id)
    then raise exception 'cross_tenant_metering_point_customer_site_rows_exist'; end if;
  if exists(select 1 from public.normalized_metering_values x join public.customers c on c.id=x.customer_id where x.company_id is distinct from c.company_id)
    then raise exception 'cross_tenant_normalized_meter_customer_rows_exist'; end if;
  if exists(select 1 from public.normalized_metering_values x join public.customer_sites s on s.id=coalesce(x.customer_site_id,x.site_id) where x.company_id is distinct from s.company_id)
    then raise exception 'cross_tenant_normalized_meter_site_rows_exist'; end if;
  if exists(select 1 from public.normalized_metering_values x join public.metering_points m on m.id=x.metering_point_id where x.company_id is distinct from m.company_id)
    then raise exception 'cross_tenant_normalized_meter_point_rows_exist'; end if;
  if exists(select 1 from public.customer_contracts x join public.metering_points m on m.id=x.metering_point_id where x.company_id is distinct from m.company_id)
    then raise exception 'cross_tenant_contract_meter_rows_exist'; end if;
  if exists(select 1 from public.customer_supply_periods x join public.customers c on c.id=x.customer_id where x.company_id is distinct from c.company_id)
    then raise exception 'cross_tenant_supply_customer_rows_exist'; end if;
  if exists(select 1 from public.customer_supply_periods x join public.metering_points m on m.id=x.metering_point_id where x.company_id is distinct from m.company_id)
    then raise exception 'cross_tenant_supply_meter_rows_exist'; end if;
  if exists(select 1 from public.customer_supply_periods x join public.customer_contracts c on c.id=x.contract_id where x.company_id is distinct from c.company_id)
    then raise exception 'cross_tenant_supply_contract_rows_exist'; end if;
  if exists(select 1 from public.billing_underlays x join public.customer_sites s on s.id=x.site_id where x.company_id is distinct from s.company_id)
    then raise exception 'cross_tenant_underlay_site_rows_exist'; end if;
  if exists(select 1 from public.billing_underlays x join public.metering_points m on m.id=x.metering_point_id where x.company_id is distinct from m.company_id)
    then raise exception 'cross_tenant_underlay_meter_rows_exist'; end if;
  if exists(select 1 from public.invoice_export_items x join public.customers c on c.id=x.customer_id where x.company_id is distinct from c.company_id)
    then raise exception 'cross_tenant_export_customer_rows_exist'; end if;
  if exists(select 1 from public.invoice_export_items x join public.billing_underlays b on b.id=x.billing_underlay_id where x.company_id is distinct from b.company_id)
    then raise exception 'cross_tenant_export_underlay_rows_exist'; end if;
  if exists(select 1 from public.invoice_export_items x join public.pricing_runs p on p.id=x.pricing_run_id where x.company_id is distinct from p.company_id)
    then raise exception 'cross_tenant_export_pricing_rows_exist'; end if;
  if exists(select 1 from public.grid_owner_information_requests x join public.customers c on c.id=x.customer_id where x.company_id is distinct from c.company_id)
    then raise exception 'cross_tenant_grid_request_customer_rows_exist'; end if;
  if exists(select 1 from public.grid_owner_information_requests x join public.customer_sites s on s.id=x.customer_site_id where x.company_id is distinct from s.company_id)
    then raise exception 'cross_tenant_grid_request_site_rows_exist'; end if;
  if exists(select 1 from public.manual_email_outbox x join public.grid_owner_information_requests r on r.id=x.request_id where x.company_id is distinct from r.company_id)
    then raise exception 'cross_tenant_manual_outbox_request_rows_exist'; end if;
  if exists(select 1 from public.manual_inbound_messages x join public.grid_owner_information_requests r on r.id=x.request_id where x.company_id is distinct from r.company_id)
    then raise exception 'cross_tenant_manual_inbound_request_rows_exist'; end if;
  if exists(select 1 from public.customer_invoices x join public.customers c on c.id=x.customer_id where x.company_id is distinct from c.company_id)
    then raise exception 'cross_tenant_customer_invoice_customer_rows_exist'; end if;
  if exists(select 1 from public.customer_invoices x join public.billing_underlays b on b.id=x.billing_underlay_id where x.company_id is distinct from b.company_id)
    then raise exception 'cross_tenant_customer_invoice_underlay_rows_exist'; end if;
  if exists(select 1 from public.customer_invoices x join public.invoice_export_items i on i.id=x.partner_export_id where x.company_id is distinct from i.company_id)
    then raise exception 'cross_tenant_customer_invoice_export_rows_exist'; end if;
end $$;

alter table public.customer_contracts drop constraint if exists customer_contracts_company_customer_fkey;
alter table public.customer_contracts add constraint customer_contracts_company_customer_fkey
  foreign key(company_id,customer_id) references public.customers(company_id,id);
alter table public.customer_contracts drop constraint if exists customer_contracts_company_site_fkey;
alter table public.customer_contracts add constraint customer_contracts_company_site_fkey
  foreign key(company_id,customer_site_id) references public.customer_sites(company_id,id);
alter table public.customer_contracts drop constraint if exists customer_contracts_company_site_alias_fkey;
alter table public.customer_contracts add constraint customer_contracts_company_site_alias_fkey
  foreign key(company_id,site_id) references public.customer_sites(company_id,id);
alter table public.customer_contracts drop constraint if exists customer_contracts_company_meter_fkey;
alter table public.customer_contracts add constraint customer_contracts_company_meter_fkey
  foreign key(company_id,metering_point_id) references public.metering_points(company_id,id);

alter table public.normalized_metering_values drop constraint if exists normalized_metering_values_company_customer_fkey;
alter table public.normalized_metering_values add constraint normalized_metering_values_company_customer_fkey
  foreign key(company_id,customer_id) references public.customers(company_id,id);
alter table public.normalized_metering_values drop constraint if exists normalized_metering_values_company_customer_site_fkey;
alter table public.normalized_metering_values add constraint normalized_metering_values_company_customer_site_fkey
  foreign key(company_id,customer_site_id) references public.customer_sites(company_id,id);
alter table public.normalized_metering_values drop constraint if exists normalized_metering_values_company_site_fkey;
alter table public.normalized_metering_values add constraint normalized_metering_values_company_site_fkey
  foreign key(company_id,site_id) references public.customer_sites(company_id,id);
alter table public.normalized_metering_values drop constraint if exists normalized_metering_values_company_meter_fkey;
alter table public.normalized_metering_values add constraint normalized_metering_values_company_meter_fkey
  foreign key(company_id,metering_point_id) references public.metering_points(company_id,id);

alter table public.customer_supply_periods drop constraint if exists customer_supply_periods_company_customer_fkey;
alter table public.customer_supply_periods add constraint customer_supply_periods_company_customer_fkey
  foreign key(company_id,customer_id) references public.customers(company_id,id);
alter table public.customer_supply_periods drop constraint if exists customer_supply_periods_company_meter_fkey;
alter table public.customer_supply_periods add constraint customer_supply_periods_company_meter_fkey
  foreign key(company_id,metering_point_id) references public.metering_points(company_id,id);
alter table public.customer_supply_periods drop constraint if exists customer_supply_periods_company_contract_fkey;
alter table public.customer_supply_periods add constraint customer_supply_periods_company_contract_fkey
  foreign key(company_id,contract_id) references public.customer_contracts(company_id,id);

alter table public.billing_underlays drop constraint if exists billing_underlays_company_customer_fkey;
alter table public.billing_underlays add constraint billing_underlays_company_customer_fkey
  foreign key(company_id,customer_id) references public.customers(company_id,id);
alter table public.billing_underlays drop constraint if exists billing_underlays_company_site_fkey;
alter table public.billing_underlays add constraint billing_underlays_company_site_fkey
  foreign key(company_id,site_id) references public.customer_sites(company_id,id);
alter table public.billing_underlays drop constraint if exists billing_underlays_company_meter_fkey;
alter table public.billing_underlays add constraint billing_underlays_company_meter_fkey
  foreign key(company_id,metering_point_id) references public.metering_points(company_id,id);

alter table public.invoice_export_items drop constraint if exists invoice_export_items_company_customer_fkey;
alter table public.invoice_export_items add constraint invoice_export_items_company_customer_fkey
  foreign key(company_id,customer_id) references public.customers(company_id,id);
alter table public.invoice_export_items drop constraint if exists invoice_export_items_company_underlay_fkey;
alter table public.invoice_export_items add constraint invoice_export_items_company_underlay_fkey
  foreign key(company_id,billing_underlay_id) references public.billing_underlays(company_id,id);
alter table public.invoice_export_items drop constraint if exists invoice_export_items_company_pricing_fkey;
alter table public.invoice_export_items add constraint invoice_export_items_company_pricing_fkey
  foreign key(company_id,pricing_run_id) references public.pricing_runs(company_id,id);

alter table public.customer_invoices drop constraint if exists customer_invoices_company_customer_fkey;
alter table public.customer_invoices add constraint customer_invoices_company_customer_fkey
  foreign key(company_id,customer_id) references public.customers(company_id,id);
alter table public.customer_invoices drop constraint if exists customer_invoices_company_underlay_fkey;
alter table public.customer_invoices add constraint customer_invoices_company_underlay_fkey
  foreign key(company_id,billing_underlay_id) references public.billing_underlays(company_id,id);
alter table public.customer_invoices drop constraint if exists customer_invoices_company_export_item_fkey;
alter table public.customer_invoices add constraint customer_invoices_company_export_item_fkey
  foreign key(company_id,partner_export_id) references public.invoice_export_items(company_id,id);

alter table public.grid_owner_information_requests drop constraint if exists grid_owner_information_requests_company_customer_fkey;
alter table public.grid_owner_information_requests add constraint grid_owner_information_requests_company_customer_fkey
  foreign key(company_id,customer_id) references public.customers(company_id,id);
alter table public.grid_owner_information_requests drop constraint if exists grid_owner_information_requests_company_site_fkey;
alter table public.grid_owner_information_requests add constraint grid_owner_information_requests_company_site_fkey
  foreign key(company_id,customer_site_id) references public.customer_sites(company_id,id);
alter table public.manual_email_outbox drop constraint if exists manual_email_outbox_company_request_fkey;
alter table public.manual_email_outbox add constraint manual_email_outbox_company_request_fkey
  foreign key(company_id,request_id) references public.grid_owner_information_requests(company_id,id);
alter table public.manual_inbound_messages drop constraint if exists manual_inbound_messages_company_request_fkey;
alter table public.manual_inbound_messages add constraint manual_inbound_messages_company_request_fkey
  foreign key(company_id,request_id) references public.grid_owner_information_requests(company_id,id);

-- Tenant-scoped idempotency for outbound mail and provider callbacks.
drop index if exists public.manual_email_outbox_idempotency_uidx;
create unique index manual_email_outbox_idempotency_uidx
  on public.manual_email_outbox(company_id,idempotency_key);
drop index if exists public.invoice_provider_events_provider_idempotency_uidx;
create unique index invoice_provider_events_provider_idempotency_uidx
  on public.invoice_provider_events(company_id,provider,idempotency_hash)
  where idempotency_hash is not null;
drop index if exists public.billing_provider_webhook_events_provider_idempotency_uidx;
create unique index billing_provider_webhook_events_provider_idempotency_uidx
  on public.billing_provider_webhook_events(company_id,provider,idempotency_key)
  where idempotency_key is not null;

-- Service-only event/outbound tables have explicit RLS and no end-user grants.
alter table public.invoice_provider_events drop constraint if exists invoice_provider_events_company_fkey;
alter table public.invoice_provider_events add constraint invoice_provider_events_company_fkey
  foreign key(company_id) references public.companies(id) on delete cascade;
alter table public.billing_provider_webhook_events drop constraint if exists billing_provider_webhook_events_company_fkey;
alter table public.billing_provider_webhook_events add constraint billing_provider_webhook_events_company_fkey
  foreign key(company_id) references public.companies(id) on delete cascade;

alter table public.invoice_provider_events enable row level security;
alter table public.billing_provider_webhook_events enable row level security;
alter table public.customer_portal_write_idempotency enable row level security;
revoke all on public.invoice_provider_events from public,anon,authenticated;
revoke all on public.billing_provider_webhook_events from public,anon,authenticated;
revoke all on public.customer_portal_write_idempotency from public,anon,authenticated;
grant select,insert,update on public.invoice_provider_events to service_role;
grant select,insert,update on public.billing_provider_webhook_events to service_role;

-- ---------------------------------------------------------------------------
-- 19. End-to-end reconciliation and queue-age observability
-- ---------------------------------------------------------------------------
create table if not exists public.platform_reconciliation_findings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  finding_key text not null,
  category text not null,
  severity text not null check(severity in ('critical','warning','info')),
  entity_type text not null,
  entity_id uuid,
  status text not null default 'open' check(status in ('open','resolved','ignored')),
  title text not null,
  details jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,finding_key)
);
create index if not exists platform_reconciliation_findings_open_idx
  on public.platform_reconciliation_findings(company_id,severity,category,last_detected_at desc)
  where status='open';
alter table public.platform_reconciliation_findings enable row level security;
revoke all on public.platform_reconciliation_findings from public,anon,authenticated;
grant select,insert,update on public.platform_reconciliation_findings to service_role;

create or replace function public.gridex_run_end_to_end_reconciliation(p_company_id uuid default null)
returns table(findings_opened integer,findings_resolved integer,total_open integer,run_at timestamptz)
language plpgsql
security definer
set search_path=public
as $$
declare v_now timestamptz:=clock_timestamp(); v_before integer; v_after integer;
begin
  if p_company_id is not null and not exists(select 1 from public.companies where id=p_company_id) then
    raise exception 'company_not_found' using errcode='P0002';
  end if;
  select count(*) into v_before from public.platform_reconciliation_findings
   where status='open' and (p_company_id is null or company_id=p_company_id);
  update public.platform_reconciliation_findings set status='resolved',resolved_at=v_now,updated_at=v_now
   where status='open' and (p_company_id is null or company_id=p_company_id);

  insert into public.platform_reconciliation_findings(company_id,finding_key,category,severity,entity_type,entity_id,status,title,details,first_detected_at,last_detected_at,resolved_at,updated_at)
  select s.company_id,'site-network:'||s.id,'network_owner','critical','customer_site',s.id,'open',
    'Anläggningen saknar verifierad nätägarkontext',
    jsonb_build_object('grid_owner_id',s.grid_owner_id,'grid_area_code',s.grid_area_code,'price_area_code',s.price_area_code,'resolution_status',s.resolution_status),v_now,v_now,null,v_now
  from public.customer_sites s
  where (p_company_id is null or s.company_id=p_company_id)
    and coalesce(s.status,'active') not in ('closed','cancelled','inactive')
    and (s.grid_owner_id is null or nullif(btrim(s.grid_area_code),'') is null or s.price_area_code not in ('SE1','SE2','SE3','SE4') or coalesce(s.resolution_status,'') not in ('resolved','verified','completed'))
  on conflict(company_id,finding_key) do update set status='open',severity=excluded.severity,title=excluded.title,details=excluded.details,last_detected_at=v_now,resolved_at=null,updated_at=v_now;

  insert into public.platform_reconciliation_findings(company_id,finding_key,category,severity,entity_type,entity_id,status,title,details,first_detected_at,last_detected_at,resolved_at,updated_at)
  select n.company_id,'meter-supply:'||n.id,'metering','critical','normalized_metering_value',n.id,'open',
    'Faktureringsbart mätvärde saknar entydig leveransperiod',jsonb_build_object('metering_point_id',n.metering_point_id,'period_start',n.period_start,'period_end',n.period_end,'billing_status',n.billing_status),v_now,v_now,null,v_now
  from public.normalized_metering_values n
  where (p_company_id is null or n.company_id=p_company_id) and n.revision_status='current'
    and n.billing_status in ('billable','invoiced') and n.supply_period_id is null
  on conflict(company_id,finding_key) do update set status='open',details=excluded.details,last_detected_at=v_now,resolved_at=null,updated_at=v_now;

  insert into public.platform_reconciliation_findings(company_id,finding_key,category,severity,entity_type,entity_id,status,title,details,first_detected_at,last_detected_at,resolved_at,updated_at)
  select b.company_id,'underlay-readiness:'||b.id,'billing','critical','billing_underlay',b.id,'open',
    'Fakturaunderlag har skickbar status utan komplett readiness',jsonb_build_object('status',b.status,'readiness_status',b.readiness_status,'issues',b.readiness_issues),v_now,v_now,null,v_now
  from public.billing_underlays b
  where (p_company_id is null or b.company_id=p_company_id)
    and b.status in ('ready','approved','priced','exported') and coalesce(b.readiness_status,'') not in ('ready','complete','approved')
  on conflict(company_id,finding_key) do update set status='open',details=excluded.details,last_detected_at=v_now,resolved_at=null,updated_at=v_now;

  insert into public.platform_reconciliation_findings(company_id,finding_key,category,severity,entity_type,entity_id,status,title,details,first_detected_at,last_detected_at,resolved_at,updated_at)
  select i.company_id,'provider-confirmation:'||i.id,'invoice_export','critical','invoice_export_item',i.id,'open',
    'Faktura är markerad skickad utan verifierad provideridentitet',jsonb_build_object('status',i.status,'provider',i.provider,'provider_invoice_guid',i.provider_invoice_guid,'provider_invoice_id',i.provider_invoice_id,'reconciliation',i.provider_reconciliation_status),v_now,v_now,null,v_now
  from public.invoice_export_items i
  where (p_company_id is null or i.company_id=p_company_id) and i.status='sent'
    and (coalesce(i.provider_invoice_guid,i.provider_invoice_id) is null or i.provider_reconciliation_status<>'confirmed')
  on conflict(company_id,finding_key) do update set status='open',details=excluded.details,last_detected_at=v_now,resolved_at=null,updated_at=v_now;

  insert into public.platform_reconciliation_findings(company_id,finding_key,category,severity,entity_type,entity_id,status,title,details,first_detected_at,last_detected_at,resolved_at,updated_at)
  select o.company_id,'manual-email-age:'||o.id,'queue_age','warning','manual_email_outbox',o.id,'open',
    'Manuellt nätägarmejl har legat för länge i kön',jsonb_build_object('status',o.status,'queued_at',o.queued_at,'attempts',o.attempts,'last_error',o.last_error),v_now,v_now,null,v_now
  from public.manual_email_outbox o
  where (p_company_id is null or o.company_id=p_company_id) and o.status in ('queued','failed') and o.queued_at<v_now-interval '15 minutes'
  on conflict(company_id,finding_key) do update set status='open',details=excluded.details,last_detected_at=v_now,resolved_at=null,updated_at=v_now;

  insert into public.platform_reconciliation_findings(company_id,finding_key,category,severity,entity_type,entity_id,status,title,details,first_detected_at,last_detected_at,resolved_at,updated_at)
  select e.company_id,'provider-event-age:'||e.id,'queue_age','warning','invoice_provider_event',e.id,'open',
    'Providerhändelse är inte färdigbehandlad',jsonb_build_object('status',e.status,'received_at',e.received_at,'attempt_count',e.attempt_count,'failure_reason',e.failure_reason),v_now,v_now,null,v_now
  from public.invoice_provider_events e
  where e.company_id is not null and (p_company_id is null or e.company_id=p_company_id)
    and e.status in ('received','processing','failed','needs_review') and e.received_at<v_now-interval '15 minutes'
  on conflict(company_id,finding_key) do update set status='open',details=excluded.details,last_detected_at=v_now,resolved_at=null,updated_at=v_now;

  select count(*) into v_after from public.platform_reconciliation_findings
   where status='open' and (p_company_id is null or company_id=p_company_id);
  return query select
    (select count(*)::integer from public.platform_reconciliation_findings where status='open' and first_detected_at=v_now and (p_company_id is null or company_id=p_company_id)),
    (select count(*)::integer from public.platform_reconciliation_findings where status='resolved' and resolved_at=v_now and (p_company_id is null or company_id=p_company_id)),
    v_after::integer,
    v_now;
end;
$$;
revoke all on function public.gridex_run_end_to_end_reconciliation(uuid) from public,anon,authenticated;
grant execute on function public.gridex_run_end_to_end_reconciliation(uuid) to service_role;

-- Final marker is deliberately last. Runtime must remain blocked if any check above fails.
insert into public.platform_schema_state(id,current_version,is_ready,blocking_issues,verified_at,updated_at)
values(true,'20260712100000',true,'[]'::jsonb,now(),now())
on conflict(id) do update set current_version=excluded.current_version,is_ready=true,blocking_issues='[]'::jsonb,verified_at=now(),updated_at=now();

