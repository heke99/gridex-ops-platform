-- Canonical market-price, area-resolution, quote and settlement hardening.
-- Additive migration for API 2026-07-24.1.
begin;

set local lock_timeout = '15s';
set local statement_timeout = '20min';
set local idle_in_transaction_session_timeout = '2min';

select pg_advisory_xact_lock(
  hashtextextended(
    'gridex:canonical-market-resolution-quote-billing:20260724120000',
    0
  )
);

-- ---------------------------------------------------------------------------
-- 1. Spot interval quality lifecycle: incomplete -> complete -> verified -> locked.
-- ---------------------------------------------------------------------------
alter table if exists public.spot_price_daily_summaries
  alter column average_sek_per_kwh drop not null,
  alter column min_sek_per_kwh drop not null,
  alter column max_sek_per_kwh drop not null;

alter table if exists public.spot_price_daily_summaries
  add column if not exists period_start timestamptz,
  add column if not exists period_end timestamptz,
  add column if not exists expected_interval_count integer,
  add column if not exists covered_duration_minutes integer,
  add column if not exists expected_duration_minutes integer,
  add column if not exists resolution text,
  add column if not exists quality_issues jsonb not null default '[]'::jsonb,
  add column if not exists provider_fetched_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists source_checksum text;

alter table if exists public.spot_price_daily_summaries
  drop constraint if exists spot_price_daily_summaries_status_check;
alter table if exists public.spot_price_daily_summaries
  add constraint spot_price_daily_summaries_status_check
  check (status in ('incomplete','complete','verified','locked'));

alter table if exists public.spot_price_monthly_summaries
  add column if not exists period_start timestamptz,
  add column if not exists period_end timestamptz,
  add column if not exists covered_duration_minutes bigint,
  add column if not exists expected_duration_minutes bigint,
  add column if not exists quality_issues jsonb not null default '[]'::jsonb,
  add column if not exists provider_fetched_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists locked_by uuid,
  add column if not exists lock_reason text,
  add column if not exists source_checksum text;

alter table if exists public.spot_price_monthly_summaries
  drop constraint if exists spot_price_monthly_summaries_status_check;
alter table if exists public.spot_price_monthly_summaries
  add constraint spot_price_monthly_summaries_status_check
  check (status in ('incomplete','complete','verified','locked'));

create or replace function public.gridex_reject_locked_market_price_mutation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if tg_op='DELETE' then
    if old.status='locked' then
      raise exception 'locked_market_price_immutable' using errcode='55000';
    end if;
    return old;
  end if;
  if old.status='locked' and new is distinct from old then
    raise exception 'locked_market_price_immutable' using errcode='55000';
  end if;
  return new;
end;
$$;

drop trigger if exists spot_price_daily_locked_immutable on public.spot_price_daily_summaries;
create trigger spot_price_daily_locked_immutable
before update or delete on public.spot_price_daily_summaries
for each row execute function public.gridex_reject_locked_market_price_mutation();

drop trigger if exists spot_price_monthly_locked_immutable on public.spot_price_monthly_summaries;
create trigger spot_price_monthly_locked_immutable
before update or delete on public.spot_price_monthly_summaries
for each row execute function public.gridex_reject_locked_market_price_mutation();

-- Verified and locked evidence must contain complete temporal coverage.
alter table if exists public.spot_price_daily_summaries
  drop constraint if exists spot_price_daily_verified_coverage_check;
alter table if exists public.spot_price_daily_summaries
  add constraint spot_price_daily_verified_coverage_check check (
    status not in ('verified','locked') or (
      period_start is not null and period_end is not null and period_end>period_start and
      average_sek_per_kwh is not null and min_sek_per_kwh is not null and max_sek_per_kwh is not null and
      covered_duration_minutes=expected_duration_minutes and case when jsonb_typeof(quality_issues)='array' then jsonb_array_length(quality_issues) else 1 end=0 and
      verified_at is not null and nullif(btrim(source_checksum),'') is not null and
      (status<>'locked' or (locked_at is not null and locked_at>=verified_at))
    )
  ) not valid;

alter table if exists public.spot_price_monthly_summaries
  drop constraint if exists spot_price_monthly_verified_coverage_check;
alter table if exists public.spot_price_monthly_summaries
  add constraint spot_price_monthly_verified_coverage_check check (
    status not in ('verified','locked') or (
      period_start is not null and period_end is not null and period_end>period_start and
      average_sek_per_kwh is not null and min_sek_per_kwh is not null and max_sek_per_kwh is not null and
      covered_duration_minutes=expected_duration_minutes and case when jsonb_typeof(quality_issues)='array' then jsonb_array_length(quality_issues) else 1 end=0 and
      verified_at is not null and nullif(btrim(source_checksum),'') is not null and
      (status<>'locked' or (locked_at is not null and locked_at>=verified_at))
    )
  ) not valid;

create table if not exists public.canonical_energy_flow_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  company_id uuid references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  site_id uuid,
  metering_point_id uuid references public.metering_points(id) on delete set null,
  resolution_id uuid references public.customer_site_resolution(id) on delete set null,
  quote_id uuid references public.website_contract_quotes(id) on delete set null,
  contract_id uuid,
  correlation_id uuid not null default gen_random_uuid(),
  source text not null,
  payload_version text not null default '1',
  payload jsonb not null default '{}'::jsonb,
  actor_type text not null default 'system',
  actor_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public.gridex_lock_spot_price_month(
  p_provider text,
  p_price_area text,
  p_billing_month text,
  p_actor_user_id uuid default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_row public.spot_price_monthly_summaries%rowtype;
  v_now timestamptz:=now();
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'spot_settlement_lock_service_role_required' using errcode='42501';
  end if;
  if upper(coalesce(p_price_area,'')) not in ('SE1','SE2','SE3','SE4')
     or coalesce(p_billing_month,'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_spot_settlement_period' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_provider))||':'||upper(trim(p_price_area))||':'||p_billing_month,0));
  select * into v_row
  from public.spot_price_monthly_summaries s
  where s.source=lower(trim(p_provider))
    and s.price_area=upper(trim(p_price_area))
    and s.billing_month=p_billing_month
  for update;
  if not found then raise exception 'market_price_unavailable' using errcode='P0002'; end if;
  if v_row.status not in ('verified','locked') or v_row.verified_at is null
     or v_row.period_start is null or v_row.period_end is null or v_row.period_end<=v_row.period_start
     or v_row.covered_duration_minutes is null or v_row.expected_duration_minutes is null
     or v_row.covered_duration_minutes is distinct from v_row.expected_duration_minutes
     or (case
           when jsonb_typeof(v_row.quality_issues) = 'array'
             then jsonb_array_length(v_row.quality_issues)
           else 1
         end) > 0
     or nullif(btrim(v_row.source_checksum),'') is null
     or (v_row.status='locked' and (v_row.locked_at is null or v_row.locked_at<v_row.verified_at)) then
    raise exception 'market_price_incomplete' using errcode='23514';
  end if;
  if v_row.status='locked' then return to_jsonb(v_row); end if;
  update public.spot_price_monthly_summaries
  set status='locked',locked_at=v_now,locked_by=p_actor_user_id,lock_reason=nullif(btrim(p_reason),''),updated_at=v_now
  where id=v_row.id
  returning * into v_row;
  insert into public.canonical_energy_flow_events(event_type,source,payload,actor_type,actor_id)
  values('market_price.period.locked','spot_settlement_lock',jsonb_build_object(
    'summary_id',v_row.id,'provider',v_row.source,'price_area',v_row.price_area,
    'billing_month',v_row.billing_month,'source_checksum',v_row.source_checksum,
    'locked_at',v_row.locked_at,'reason',v_row.lock_reason
  ),case when p_actor_user_id is null then 'system' else 'user' end,p_actor_user_id);
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.gridex_lock_spot_price_month(text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.gridex_lock_spot_price_month(text,text,text,uuid,text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Canonical provider+area+day jobs with distributed claim semantics.
-- ---------------------------------------------------------------------------
create table if not exists public.spot_price_import_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  provider text not null,
  price_area text not null check (price_area in ('SE1','SE2','SE3','SE4')),
  calendar_date date not null,
  status text not null default 'queued' check (status in ('queued','running','retry_wait','completed','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  last_error_message text,
  correlation_id uuid not null default gen_random_uuid(),
  source_checksum text,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,price_area,calendar_date)
);

create index if not exists spot_price_import_jobs_due_idx
  on public.spot_price_import_jobs(status,next_attempt_at,calendar_date);
create index if not exists spot_price_import_jobs_running_idx
  on public.spot_price_import_jobs(started_at)
  where status='running';

alter table public.spot_price_import_jobs enable row level security;
drop policy if exists spot_price_import_jobs_service_role_all on public.spot_price_import_jobs;
create policy spot_price_import_jobs_service_role_all
on public.spot_price_import_jobs for all to service_role using(true) with check(true);

grant select,insert,update,delete on public.spot_price_import_jobs to service_role;

create or replace function public.gridex_claim_spot_price_import_job(
  p_provider text,
  p_price_area text,
  p_calendar_date date,
  p_company_id uuid default null,
  p_stale_after interval default interval '15 minutes',
  p_force boolean default false
) returns table(
  id uuid,
  claimed boolean,
  status text,
  attempt_count integer,
  correlation_id uuid
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_job public.spot_price_import_jobs%rowtype;
begin
  if upper(coalesce(p_price_area,'')) not in ('SE1','SE2','SE3','SE4') then
    raise exception 'invalid_price_area' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_provider)) || ':' || upper(trim(p_price_area)) || ':' || p_calendar_date::text,0));

  select * into v_job
  from public.spot_price_import_jobs j
  where j.provider=lower(trim(p_provider))
    and j.price_area=upper(trim(p_price_area))
    and j.calendar_date=p_calendar_date
  for update;

  if not found then
    insert into public.spot_price_import_jobs(
      company_id,provider,price_area,calendar_date,status,attempt_count,started_at,completed_at,
      last_error_code,last_error_message,next_attempt_at,updated_at
    ) values (
      p_company_id,lower(trim(p_provider)),upper(trim(p_price_area)),p_calendar_date,'running',1,now(),null,
      null,null,null,now()
    ) returning * into v_job;
    return query select v_job.id,true,v_job.status,v_job.attempt_count,v_job.correlation_id;
    return;
  end if;

  if v_job.status='completed' and not coalesce(p_force,false) then
    return query select v_job.id,false,v_job.status,v_job.attempt_count,v_job.correlation_id;
    return;
  end if;

  if v_job.status='running' and v_job.started_at > now()-p_stale_after then
    return query select v_job.id,false,v_job.status,v_job.attempt_count,v_job.correlation_id;
    return;
  end if;

  if v_job.status='retry_wait' and v_job.next_attempt_at is not null and v_job.next_attempt_at > now() then
    return query select v_job.id,false,v_job.status,v_job.attempt_count,v_job.correlation_id;
    return;
  end if;

  update public.spot_price_import_jobs j
  set company_id=coalesce(p_company_id,j.company_id),
      status='running',
      attempt_count=j.attempt_count+1,
      started_at=now(),
      completed_at=null,
      next_attempt_at=null,
      last_error_code=null,
      last_error_message=null,
      correlation_id=gen_random_uuid(),
      updated_at=now()
  where j.id=v_job.id
  returning * into v_job;

  return query select v_job.id,true,v_job.status,v_job.attempt_count,v_job.correlation_id;
end;
$$;

revoke all on function public.gridex_claim_spot_price_import_job(text,text,date,uuid,interval,boolean) from public,anon,authenticated;
grant execute on function public.gridex_claim_spot_price_import_job(text,text,date,uuid,interval,boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Explicit indicative preview evidence, separate from settlement summaries.
-- ---------------------------------------------------------------------------
create table if not exists public.market_price_previews (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  price_area text not null check (price_area in ('SE1','SE2','SE3','SE4')),
  reference_period text not null check (reference_period in ('latest_complete_day','rolling_7_days','rolling_30_days','month_to_date','forecast')),
  period_start date not null,
  period_end date not null,
  as_of timestamptz not null,
  price_sek_per_kwh numeric not null,
  source_currency text not null default 'SEK',
  unit text not null default 'sek_per_kwh',
  includes_vat boolean not null default false,
  includes_supplier_fees boolean not null default false,
  includes_grid_fees boolean not null default false,
  is_indicative boolean not null default true,
  fallback_used boolean not null default false,
  fallback_reason text,
  stale_after timestamptz not null,
  status text not null default 'active' check (status in ('active','superseded','expired')),
  source_summary_ids uuid[] not null default '{}'::uuid[],
  source_checksum text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  check (is_indicative=true)
);

create unique index if not exists market_price_previews_current_uidx
  on public.market_price_previews(provider,price_area,reference_period)
  where status='active';
create index if not exists market_price_previews_lookup_idx
  on public.market_price_previews(price_area,reference_period,as_of desc);

alter table public.market_price_previews enable row level security;
drop policy if exists market_price_previews_service_role_all on public.market_price_previews;
create policy market_price_previews_service_role_all
on public.market_price_previews for all to service_role using(true) with check(true);
grant select,insert,update,delete on public.market_price_previews to service_role;

create or replace function public.gridex_publish_market_price_preview(
  p_provider text,
  p_price_area text,
  p_reference_period text,
  p_period_start date,
  p_period_end date,
  p_as_of timestamptz,
  p_price_sek_per_kwh numeric,
  p_stale_after timestamptz,
  p_fallback_used boolean default false,
  p_fallback_reason text default null,
  p_source_summary_ids uuid[] default '{}'::uuid[],
  p_source_checksum text default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_id uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'market_preview_publish_service_role_required' using errcode='42501';
  end if;
  if upper(coalesce(p_price_area,'')) not in ('SE1','SE2','SE3','SE4')
     or p_reference_period not in ('latest_complete_day','rolling_7_days','rolling_30_days','month_to_date','forecast')
     or p_period_end<p_period_start or p_as_of is null or p_stale_after<=p_as_of
     or p_price_sek_per_kwh is null then
    raise exception 'invalid_market_preview' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_provider))||':'||upper(trim(p_price_area))||':'||p_reference_period,0));
  update public.market_price_previews
  set status='superseded',updated_at=now()
  where provider=lower(trim(p_provider)) and price_area=upper(trim(p_price_area))
    and reference_period=p_reference_period and status='active';
  insert into public.market_price_previews(
    provider,price_area,reference_period,period_start,period_end,as_of,price_sek_per_kwh,
    stale_after,status,fallback_used,fallback_reason,source_summary_ids,source_checksum,metadata,updated_at
  ) values (
    lower(trim(p_provider)),upper(trim(p_price_area)),p_reference_period,p_period_start,p_period_end,p_as_of,p_price_sek_per_kwh,
    p_stale_after,'active',coalesce(p_fallback_used,false),nullif(btrim(p_fallback_reason),''),
    coalesce(p_source_summary_ids,'{}'::uuid[]),p_source_checksum,coalesce(p_metadata,'{}'::jsonb),now()
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.gridex_publish_market_price_preview(text,text,text,date,date,timestamptz,numeric,timestamptz,boolean,text,uuid[],text,jsonb) from public,anon,authenticated;
grant execute on function public.gridex_publish_market_price_preview(text,text,text,date,date,timestamptz,numeric,timestamptz,boolean,text,uuid[],text,jsonb) to service_role;

-- E-mail is a weak identity signal and may be shared by household members or
-- company contacts. It must not force an automatic customer merge. Strong
-- identifiers and tenant external references remain canonical match keys.
drop index if exists public.ux_customers_company_email;
create index if not exists idx_customers_company_normalized_email_weak
  on public.customers(company_id,normalized_email)
  where normalized_email is not null;

-- ---------------------------------------------------------------------------
-- 4. Tenant-bound resolution provenance and quote binding.
-- ---------------------------------------------------------------------------
alter table if exists public.customer_site_resolution
  add column if not exists resolved_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists resolver_version text not null default 'energy-resolver-v2',
  add column if not exists geodata_version text,
  add column if not exists source_claims jsonb not null default '{}'::jsonb,
  add column if not exists conflict_code text;

update public.customer_site_resolution
set resolved_at=coalesce(resolved_at,created_at),
    expires_at=coalesce(expires_at,created_at+interval '24 hours')
where resolved_at is null or expires_at is null;

create index if not exists customer_site_resolution_expiry_idx
  on public.customer_site_resolution(company_id,expires_at)
  where resolution_status not in ('failed','needs_review');

alter table if exists public.website_contract_quotes
  add column if not exists energy_resolution_id uuid references public.customer_site_resolution(id) on delete restrict,
  add column if not exists resolution_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists resolver_version text,
  add column if not exists geodata_version text,
  add column if not exists market_reference jsonb not null default '{}'::jsonb,
  add column if not exists quote_hash text,
  add column if not exists resolution_binding_status text not null default 'legacy_unverified';

alter table if exists public.website_contract_quotes
  drop constraint if exists website_contract_quotes_resolution_binding_status_check;
alter table if exists public.website_contract_quotes
  add constraint website_contract_quotes_resolution_binding_status_check
  check (resolution_binding_status in ('verified','legacy_unverified'));

create index if not exists website_contract_quotes_resolution_idx
  on public.website_contract_quotes(company_id,energy_resolution_id,created_at desc);

create or replace function public.gridex_reject_quote_snapshot_mutation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.company_id is distinct from old.company_id
     or new.quote_reference is distinct from old.quote_reference
     or new.offer_reference is distinct from old.offer_reference
     or new.contract_product_version_id is distinct from old.contract_product_version_id
     or new.contract_publication_version_id is distinct from old.contract_publication_version_id
     or new.price_plan_version_id is distinct from old.price_plan_version_id
     or new.legal_bundle_version_id is distinct from old.legal_bundle_version_id
     or new.customer_type is distinct from old.customer_type
     or new.price_area is distinct from old.price_area
     or new.grid_area_code is distinct from old.grid_area_code
     or new.annual_consumption_kwh is distinct from old.annual_consumption_kwh
     or new.start_date is distinct from old.start_date
     or new.energy_resolution_id is distinct from old.energy_resolution_id
     or new.resolution_snapshot is distinct from old.resolution_snapshot
     or new.resolver_version is distinct from old.resolver_version
     or new.geodata_version is distinct from old.geodata_version
     or new.resolution_binding_status is distinct from old.resolution_binding_status
     or new.market_reference is distinct from old.market_reference
     or new.market_data_timestamp is distinct from old.market_data_timestamp
     or new.market_sources is distinct from old.market_sources
     or new.assumptions is distinct from old.assumptions
     or new.pricing_snapshot_schema_version is distinct from old.pricing_snapshot_schema_version
     or new.postal_code is distinct from old.postal_code
     or new.quote_snapshot is distinct from old.quote_snapshot
     or new.quote_hash is distinct from old.quote_hash then
    raise exception 'website_quote_snapshot_immutable' using errcode='55000';
  end if;
  return new;
end;
$$;

drop trigger if exists website_contract_quotes_snapshot_immutable on public.website_contract_quotes;
create trigger website_contract_quotes_snapshot_immutable
before update on public.website_contract_quotes
for each row execute function public.gridex_reject_quote_snapshot_mutation();

-- ---------------------------------------------------------------------------
-- 5. Full canonical area context on metering points.
-- ---------------------------------------------------------------------------
alter table if exists public.metering_points
  add column if not exists grid_owner_id uuid,
  add column if not exists grid_owner_name text,
  add column if not exists price_area text,
  add column if not exists energy_resolution_id uuid references public.customer_site_resolution(id) on delete set null,
  add column if not exists resolution_source text,
  add column if not exists resolution_confidence numeric(5,4),
  add column if not exists resolution_status text,
  add column if not exists resolved_at timestamptz,
  add column if not exists geodata_version text;

alter table if exists public.metering_points
  drop constraint if exists metering_points_price_area_check;
alter table if exists public.metering_points
  add constraint metering_points_price_area_check
  check (price_area is null or price_area in ('SE1','SE2','SE3','SE4'));

update public.metering_points
set price_area=coalesce(price_area,bidding_zone_code),
    bidding_zone_code=coalesce(bidding_zone_code,price_area)
where (price_area is null and bidding_zone_code in ('SE1','SE2','SE3','SE4'))
   or (bidding_zone_code is null and price_area in ('SE1','SE2','SE3','SE4'));

-- ---------------------------------------------------------------------------
-- 6. Geodata version lifecycle and audit chain.
-- ---------------------------------------------------------------------------
create table if not exists public.energy_geodata_versions (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'svk_arcgis',
  version_key text not null unique,
  status text not null default 'importing' check (status in ('importing','verified','failed','superseded')),
  source_url text,
  cursor_offset integer not null default 0,
  feature_count integer not null default 0,
  coverage_status text not null default 'unknown' check (coverage_status in ('unknown','partial','complete','failed')),
  checksum text,
  started_at timestamptz not null default now(),
  verified_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.platform_grid_area_geometries
  add column if not exists geodata_version_id uuid references public.energy_geodata_versions(id) on delete set null;
create index if not exists platform_grid_area_geometries_version_idx
  on public.platform_grid_area_geometries(geodata_version_id,is_active);

create table if not exists public.energy_geodata_features_staging (
  id uuid primary key default gen_random_uuid(),
  geodata_version_id uuid not null references public.energy_geodata_versions(id) on delete cascade,
  feature_id text not null,
  source_url text,
  properties jsonb not null default '{}'::jsonb,
  geometry_geojson jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(geodata_version_id,feature_id)
);
create index if not exists energy_geodata_features_staging_version_idx
  on public.energy_geodata_features_staging(geodata_version_id,feature_id);
alter table public.energy_geodata_features_staging enable row level security;
drop policy if exists energy_geodata_features_staging_service_role_all on public.energy_geodata_features_staging;
create policy energy_geodata_features_staging_service_role_all
on public.energy_geodata_features_staging for all to service_role using(true) with check(true);
grant select,insert,update,delete on public.energy_geodata_features_staging to service_role;

create or replace function public.gridex_stage_energy_geodata_feature(
  p_geodata_version_id uuid,
  p_feature_id text,
  p_properties jsonb,
  p_geometry_geojson jsonb,
  p_source_url text default null
) returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_id uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'energy_geodata_stage_service_role_required' using errcode='42501';
  end if;
  if p_geodata_version_id is null or nullif(btrim(p_feature_id),'') is null
     or p_geometry_geojson is null or jsonb_typeof(p_geometry_geojson)<>'object' then
    raise exception 'invalid_energy_geodata_feature' using errcode='22023';
  end if;
  if not exists (
    select 1 from public.energy_geodata_versions
    where id=p_geodata_version_id and provider='svk_arcgis' and status='importing'
  ) then
    raise exception 'energy_geodata_version_not_importing' using errcode='55000';
  end if;
  insert into public.energy_geodata_features_staging(
    geodata_version_id,feature_id,source_url,properties,geometry_geojson,updated_at
  ) values (
    p_geodata_version_id,btrim(p_feature_id),p_source_url,coalesce(p_properties,'{}'::jsonb),p_geometry_geojson,now()
  )
  on conflict(geodata_version_id,feature_id) do update set
    source_url=excluded.source_url,
    properties=excluded.properties,
    geometry_geojson=excluded.geometry_geojson,
    updated_at=now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.gridex_stage_energy_geodata_feature(uuid,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.gridex_stage_energy_geodata_feature(uuid,text,jsonb,jsonb,text) to service_role;

create or replace function public.gridex_promote_energy_geodata_version(
  p_geodata_version_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp,extensions
as $$
declare
  v_version public.energy_geodata_versions%rowtype;
  v_feature record;
  v_feature_count integer:=0;
  v_now timestamptz:=now();
begin
  if coalesce(auth.role(),'')<>'service_role' then
    raise exception 'energy_geodata_promote_service_role_required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('energy-geodata:'||p_geodata_version_id::text,0));
  select * into v_version from public.energy_geodata_versions
  where id=p_geodata_version_id for update;
  if not found then raise exception 'energy_geodata_version_not_found' using errcode='P0002'; end if;
  if v_version.status='verified' then return to_jsonb(v_version); end if;
  if v_version.status<>'importing' or v_version.coverage_status<>'complete' then
    raise exception 'energy_geodata_version_not_complete' using errcode='23514';
  end if;
  select count(*)::integer into v_feature_count
  from public.energy_geodata_features_staging where geodata_version_id=p_geodata_version_id;
  if v_feature_count<=0 or v_feature_count<>v_version.feature_count then
    raise exception 'energy_geodata_feature_count_mismatch' using errcode='23514';
  end if;

  for v_feature in
    select feature_id,properties,geometry_geojson,source_url
    from public.energy_geodata_features_staging
    where geodata_version_id=p_geodata_version_id
    order by feature_id
  loop
    perform public.gridex_import_grid_area_geojson_feature(
      v_feature.feature_id,v_feature.properties,v_feature.geometry_geojson,v_feature.source_url
    );
    update public.platform_grid_area_geometries
    set geodata_version_id=p_geodata_version_id,is_active=true,updated_at=v_now
    where source='svk_arcgis' and source_feature_id=v_feature.feature_id;
  end loop;

  -- The active polygon set changes only when the complete version is promoted.
  -- Features missing from the new source version are deactivated atomically.
  update public.platform_grid_area_geometries
  set is_active=false,updated_at=v_now
  where source='svk_arcgis'
    and is_active=true
    and geodata_version_id is distinct from p_geodata_version_id;

  update public.energy_geodata_versions
  set status='superseded',updated_at=v_now
  where provider=v_version.provider and status='verified' and id<>p_geodata_version_id;

  update public.energy_geodata_versions
  set status='verified',coverage_status='complete',verified_at=v_now,completed_at=v_now,updated_at=v_now
  where id=p_geodata_version_id
  returning * into v_version;

  insert into public.canonical_energy_flow_events(event_type,source,payload,actor_type)
  values('energy_geodata.version.verified','svk_arcgis',jsonb_build_object(
    'geodata_version_id',v_version.id,'geodata_version',v_version.version_key,
    'feature_count',v_feature_count,'verified_at',v_version.verified_at
  ),'system');
  return to_jsonb(v_version);
end;
$$;
revoke all on function public.gridex_promote_energy_geodata_version(uuid) from public,anon,authenticated;
grant execute on function public.gridex_promote_energy_geodata_version(uuid) to service_role;

create unique index if not exists energy_geodata_versions_verified_uidx
  on public.energy_geodata_versions(provider)
  where status='verified';
create unique index if not exists energy_geodata_versions_importing_uidx
  on public.energy_geodata_versions(provider)
  where status='importing';

alter table public.energy_geodata_versions enable row level security;
drop policy if exists energy_geodata_versions_service_role_all on public.energy_geodata_versions;
create policy energy_geodata_versions_service_role_all
on public.energy_geodata_versions for all to service_role using(true) with check(true);
grant select,insert,update,delete on public.energy_geodata_versions to service_role;

create index if not exists canonical_energy_flow_events_correlation_idx
  on public.canonical_energy_flow_events(correlation_id,created_at);
create index if not exists canonical_energy_flow_events_entity_idx
  on public.canonical_energy_flow_events(company_id,customer_id,contract_id,created_at desc);

alter table public.canonical_energy_flow_events enable row level security;
drop policy if exists canonical_energy_flow_events_service_role_all on public.canonical_energy_flow_events;
create policy canonical_energy_flow_events_service_role_all
on public.canonical_energy_flow_events for all to service_role using(true) with check(true);
drop policy if exists canonical_energy_flow_events_tenant_read on public.canonical_energy_flow_events;
create policy canonical_energy_flow_events_tenant_read
on public.canonical_energy_flow_events for select to authenticated
using(company_id is not null and public.gridex_can_read_company(company_id));
grant select on public.canonical_energy_flow_events to authenticated,service_role;
grant insert,update,delete on public.canonical_energy_flow_events to service_role;

-- ---------------------------------------------------------------------------
-- 7. Controlled remediation queue. Unsafe historical changes are review-only.
-- ---------------------------------------------------------------------------
create table if not exists public.canonical_energy_remediation_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  remediation_type text not null,
  entity_type text not null,
  entity_id uuid,
  fingerprint text not null,
  reason_code text not null,
  severity text not null default 'warning' check (severity in ('warning','blocking','critical')),
  status text not null default 'open' check (status in ('open','in_review','resolved','ignored')),
  payload jsonb not null default '{}'::jsonb,
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(remediation_type,fingerprint)
);
create index if not exists canonical_energy_remediation_queue_open_idx
  on public.canonical_energy_remediation_queue(status,severity,created_at) where status in ('open','in_review');
alter table public.canonical_energy_remediation_queue enable row level security;
drop policy if exists canonical_energy_remediation_queue_service_role_all on public.canonical_energy_remediation_queue;
create policy canonical_energy_remediation_queue_service_role_all
on public.canonical_energy_remediation_queue for all to service_role using(true) with check(true);
drop policy if exists canonical_energy_remediation_queue_tenant_read on public.canonical_energy_remediation_queue;
create policy canonical_energy_remediation_queue_tenant_read
on public.canonical_energy_remediation_queue for select to authenticated
using(company_id is not null and public.gridex_can_read_company(company_id));
grant select on public.canonical_energy_remediation_queue to authenticated,service_role;
grant insert,update,delete on public.canonical_energy_remediation_queue to service_role;

-- ---------------------------------------------------------------------------
-- 8. Read-only diagnostics.
-- ---------------------------------------------------------------------------
create or replace view public.gridex_latest_spot_price_by_area_v
with (security_invoker=true) as
select distinct on (price_area)
  price_area,source,price_date,status,average_sek_per_kwh,provider_fetched_at,verified_at,locked_at,updated_at
from public.spot_price_daily_summaries
order by price_area,price_date desc,updated_at desc;

create or replace view public.gridex_spot_interval_gaps_v
with (security_invoker=true) as
with ordered as (
  select source,price_area,time_start,time_end,
         lag(time_end) over(partition by source,price_area order by time_start,time_end) as previous_end
  from public.spot_price_intervals
)
select source,price_area,previous_end as gap_start,time_start as gap_end,
       extract(epoch from (time_start-previous_end))/60 as gap_minutes
from ordered
where previous_end is not null and time_start>previous_end;

create or replace view public.gridex_spot_interval_overlaps_v
with (security_invoker=true) as
with ordered as (
  select source,price_area,id,time_start,time_end,
         lag(time_end) over(partition by source,price_area order by time_start,time_end) as previous_end
  from public.spot_price_intervals
)
select source,price_area,id,time_start,time_end,previous_end
from ordered
where previous_end is not null and time_start<previous_end;

create or replace view public.gridex_spot_incomplete_days_v
with (security_invoker=true) as
select * from public.spot_price_daily_summaries where status='incomplete';

create or replace view public.gridex_spot_complete_unlocked_periods_v
with (security_invoker=true) as
select 'day'::text as period_type,id,source,price_area,price_date::text as period_key,status,verified_at,locked_at
from public.spot_price_daily_summaries where status in ('complete','verified')
union all
select 'month',id,source,price_area,billing_month,status,verified_at,locked_at
from public.spot_price_monthly_summaries where status in ('complete','verified');

create or replace view public.gridex_locked_spot_periods_missing_evidence_v
with (security_invoker=true) as
select 'day'::text as period_type,id,source,price_area,price_date::text as period_key,status,
       period_start,period_end,covered_duration_minutes,expected_duration_minutes,quality_issues,
       verified_at,locked_at,source_checksum
from public.spot_price_daily_summaries
where status='locked' and (
  period_start is null or period_end is null or period_end<=period_start
  or covered_duration_minutes is null or expected_duration_minutes is null
  or covered_duration_minutes is distinct from expected_duration_minutes
  or case when jsonb_typeof(quality_issues)='array' then jsonb_array_length(quality_issues) else 1 end>0
  or verified_at is null or locked_at is null or locked_at<verified_at
  or nullif(btrim(source_checksum),'') is null
)
union all
select 'month',id,source,price_area,billing_month,status,
       period_start,period_end,covered_duration_minutes,expected_duration_minutes,quality_issues,
       verified_at,locked_at,source_checksum
from public.spot_price_monthly_summaries
where status='locked' and (
  period_start is null or period_end is null or period_end<=period_start
  or covered_duration_minutes is null or expected_duration_minutes is null
  or covered_duration_minutes is distinct from expected_duration_minutes
  or case when jsonb_typeof(quality_issues)='array' then jsonb_array_length(quality_issues) else 1 end>0
  or verified_at is null or locked_at is null or locked_at<verified_at
  or nullif(btrim(source_checksum),'') is null
);

create or replace view public.gridex_stale_market_previews_v
with (security_invoker=true) as
select *, now()>stale_after as is_stale
from public.market_price_previews
where status='active' and now()>stale_after;

create or replace view public.gridex_old_geodata_versions_v
with (security_invoker=true) as
select *, now()-coalesce(verified_at,completed_at,started_at) as age
from public.energy_geodata_versions
where status='verified' and coalesce(verified_at,completed_at,started_at)<now()-interval '30 days';

create or replace view public.gridex_energy_resolutions_needing_review_v
with (security_invoker=true) as
select * from public.customer_site_resolution
where resolution_status in ('needs_review','failed') or automation_allowed=false or expires_at<=now();

create or replace view public.gridex_metering_points_incomplete_area_context_v
with (security_invoker=true) as
select id,company_id,customer_id,site_id,customer_site_id,grid_area_code,grid_owner_id,grid_owner_name,
       coalesce(price_area,bidding_zone_code) as price_area,energy_resolution_id,resolution_status,geodata_version
from public.metering_points
where grid_area_code is null
   or grid_owner_id is null
   or coalesce(price_area,bidding_zone_code) is null
   or energy_resolution_id is null;

create or replace view public.gridex_stuck_spot_import_jobs_v
with (security_invoker=true) as
select id,provider,price_area,calendar_date,status,attempt_count,started_at,next_attempt_at,
       last_error_code,last_error_message,correlation_id,now()-started_at as running_age
from public.spot_price_import_jobs
where (status='running' and started_at<now()-interval '15 minutes')
   or (status='retry_wait' and next_attempt_at is not null and next_attempt_at<now()-interval '15 minutes');

create or replace view public.gridex_quotes_without_canonical_resolution_v
with (security_invoker=true) as
select id,company_id,quote_reference,offer_reference,status,created_at,valid_until,resolution_binding_status
from public.website_contract_quotes
where energy_resolution_id is null or resolution_binding_status<>'verified';

create or replace view public.gridex_customer_contracts_missing_price_snapshot_v
with (security_invoker=true) as
select id,company_id,customer_id,site_id,metering_point_id,status,created_at
from public.customer_contracts
where status in ('signed','active') and contract_price_snapshot_id is null;

create or replace view public.gridex_customer_identity_duplicate_candidates_v
with (security_invoker=true) as
select company_id,'personal_number'::text as match_type,normalized_personal_number as match_key,
       count(*) as customer_count,array_agg(id order by created_at) as customer_ids
from public.customers
where normalized_personal_number is not null
group by company_id,normalized_personal_number having count(*)>1
union all
select company_id,'organization_number',normalized_org_number,count(*),array_agg(id order by created_at)
from public.customers
where normalized_org_number is not null
group by company_id,normalized_org_number having count(*)>1
union all
select company_id,'email_weak_signal',normalized_email,count(*),array_agg(id order by created_at)
from public.customers
where normalized_email is not null
group by company_id,normalized_email having count(*)>1;

grant select on public.gridex_latest_spot_price_by_area_v,
  public.gridex_spot_interval_gaps_v,
  public.gridex_spot_interval_overlaps_v,
  public.gridex_spot_incomplete_days_v,
  public.gridex_spot_complete_unlocked_periods_v,
  public.gridex_locked_spot_periods_missing_evidence_v,
  public.gridex_stale_market_previews_v,
  public.gridex_old_geodata_versions_v,
  public.gridex_energy_resolutions_needing_review_v,
  public.gridex_metering_points_incomplete_area_context_v,
  public.gridex_stuck_spot_import_jobs_v,
  public.gridex_quotes_without_canonical_resolution_v,
  public.gridex_customer_contracts_missing_price_snapshot_v,
  public.gridex_customer_identity_duplicate_candidates_v
  to authenticated,service_role;

comment on table public.energy_geodata_features_staging is
  'Version-bound SVK features. Active resolver geometry is changed only by atomic version promotion.';
comment on column public.platform_grid_area_geometries.geodata_version_id is
  'Verified geodata version that atomically published this active polygon. Previous versions are deactivated during promotion.';
comment on table public.canonical_energy_remediation_queue is
  'Review queue for unsafe or ambiguous canonical-flow backfill findings. Rows are never auto-merged.';
comment on function public.gridex_lock_spot_price_month(text,text,text,uuid,text) is
  'Explicit service-role settlement lock. A locked summary is immutable and never subject to preview freshness.';
comment on table public.market_price_previews is
  'Indicative quote/display evidence only. It is forbidden as final settlement evidence.';
comment on column public.website_contract_quotes.energy_resolution_id is
  'Tenant-bound canonical OPS resolution used to derive the quote price area.';
comment on column public.website_contract_quotes.market_reference is
  'Immutable provenance for indicative market data. Never final settlement evidence.';

commit;
