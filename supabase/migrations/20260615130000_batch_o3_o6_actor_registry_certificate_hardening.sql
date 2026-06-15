-- Batch O3-O6 — Actor registry XML import, duplicate safety, certificate refresh and customer-flow readiness
-- Production-safe, additive and idempotent. No hard-coded Ediel IDs, tenants, subaddresses or certificate fingerprints.

create extension if not exists pgcrypto with schema extensions;

-- Import run header. source_hash gives idempotency for repeated file uploads.
create table if not exists public.actor_registry_import_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  uploaded_by uuid null,
  source text not null,
  source_filename text null,
  source_hash text not null,
  status text not null default 'pending' check (status in ('pending','running','completed','completed_with_warnings','failed','cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  total_records integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  conflict_count integer not null default 0,
  error_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists actor_registry_import_runs_source_hash_uidx
  on public.actor_registry_import_runs(source_hash);
create index if not exists actor_registry_import_runs_status_idx
  on public.actor_registry_import_runs(status, started_at desc);
create index if not exists actor_registry_import_runs_company_idx
  on public.actor_registry_import_runs(company_id, started_at desc) where company_id is not null;

-- Per-record staging. Strong identifiers are normalized here before safe apply.
create table if not exists public.actor_registry_import_items (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.actor_registry_import_runs(id) on delete cascade,
  company_id uuid null,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  normalized_name text null,
  normalized_org_no text null,
  normalized_ediel_id text null,
  normalized_eic text null,
  roles text[] not null default '{}'::text[],
  routes jsonb not null default '[]'::jsonb,
  certificates jsonb not null default '[]'::jsonb,
  match_status text not null default 'pending' check (match_status in ('pending','matched','created','updated','unchanged','conflict','error','skipped')),
  matched_actor_id uuid null,
  match_confidence text null,
  match_reason text null,
  review_required boolean not null default false,
  review_reason text null,
  applied_at timestamptz null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists actor_registry_import_items_run_idx on public.actor_registry_import_items(import_run_id);
create index if not exists actor_registry_import_items_company_idx on public.actor_registry_import_items(company_id) where company_id is not null;
create index if not exists actor_registry_import_items_ediel_idx on public.actor_registry_import_items(normalized_ediel_id) where normalized_ediel_id is not null;
create index if not exists actor_registry_import_items_org_idx on public.actor_registry_import_items(normalized_org_no) where normalized_org_no is not null;
create index if not exists actor_registry_import_items_actor_idx on public.actor_registry_import_items(matched_actor_id) where matched_actor_id is not null;
create index if not exists actor_registry_import_items_status_idx on public.actor_registry_import_items(match_status, review_required);

-- General conflict queue for actors, grid owners and suppliers.
create table if not exists public.actor_registry_conflicts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  import_run_id uuid null references public.actor_registry_import_runs(id) on delete set null,
  import_item_id uuid null references public.actor_registry_import_items(id) on delete set null,
  actor_id uuid null,
  grid_owner_id uuid null,
  supplier_id uuid null,
  conflict_type text not null,
  severity text not null default 'blocking' check (severity in ('info','warning','blocking')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved','ignored')),
  title text not null,
  message text not null,
  current_data jsonb not null default '{}'::jsonb,
  incoming_data jsonb not null default '{}'::jsonb,
  resolution text null,
  resolved_by uuid null,
  resolved_at timestamptz null,
  conflict_fingerprint text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists actor_registry_conflicts_fingerprint_uidx
  on public.actor_registry_conflicts(conflict_fingerprint) where conflict_fingerprint is not null;
create index if not exists actor_registry_conflicts_status_idx
  on public.actor_registry_conflicts(status, severity, conflict_type, created_at desc);
create index if not exists actor_registry_conflicts_actor_idx on public.actor_registry_conflicts(actor_id, status) where actor_id is not null;
create index if not exists actor_registry_conflicts_grid_owner_idx on public.actor_registry_conflicts(grid_owner_id, status) where grid_owner_id is not null;
create index if not exists actor_registry_conflicts_company_idx on public.actor_registry_conflicts(company_id, status) where company_id is not null;

-- Import tracking fields on platform actors.
alter table public.platform_market_actors add column if not exists not_seen_in_latest_import boolean not null default false;
alter table public.platform_market_actors add column if not exists last_seen_in_import_at timestamptz;
alter table public.platform_market_actors add column if not exists registry_import_status text not null default 'unknown';
create index if not exists platform_market_actors_import_seen_idx
  on public.platform_market_actors(not_seen_in_latest_import, last_seen_in_import_at desc);

-- Complete existing certificate cache with canonical columns while keeping legacy columns used by existing code.
alter table public.ediel_certificate_directory_cache add column if not exists platform_market_actor_id uuid;
alter table public.ediel_certificate_directory_cache add column if not exists environment text;
alter table public.ediel_certificate_directory_cache add column if not exists purpose text;
alter table public.ediel_certificate_directory_cache add column if not exists certificate_pem text;
alter table public.ediel_certificate_directory_cache add column if not exists certificate_der bytea;
alter table public.ediel_certificate_directory_cache add column if not exists fingerprint_sha256 text;
alter table public.ediel_certificate_directory_cache add column if not exists valid_from timestamptz;
alter table public.ediel_certificate_directory_cache add column if not exists valid_to timestamptz;
alter table public.ediel_certificate_directory_cache add column if not exists lookup_key text;
alter table public.ediel_certificate_directory_cache add column if not exists lookup_status text not null default 'found';
alter table public.ediel_certificate_directory_cache add column if not exists last_checked_at timestamptz default now();
alter table public.ediel_certificate_directory_cache add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.ediel_certificate_directory_cache
set certificate_pem = coalesce(certificate_pem, public_certificate_pem),
    fingerprint_sha256 = coalesce(fingerprint_sha256, sha256_fingerprint),
    valid_from = coalesce(valid_from, not_before),
    valid_to = coalesce(valid_to, not_after),
    last_checked_at = coalesce(last_checked_at, fetched_at),
    lookup_key = coalesce(lookup_key, smtp_email),
    lookup_status = coalesce(lookup_status, case when status in ('valid','expired','not_yet_valid','invalid','unknown') then 'found' else 'unknown' end),
    certificate_der = coalesce(certificate_der, case when raw_der_base64 is not null then decode(raw_der_base64, 'base64') else null end)
where certificate_pem is null
   or fingerprint_sha256 is null
   or valid_from is null
   or valid_to is null
   or last_checked_at is null
   or lookup_key is null
   or certificate_der is null;

create index if not exists ediel_certificate_directory_cache_actor_idx
  on public.ediel_certificate_directory_cache(platform_market_actor_id) where platform_market_actor_id is not null;
create index if not exists ediel_certificate_directory_cache_canonical_fp_idx
  on public.ediel_certificate_directory_cache(fingerprint_sha256) where fingerprint_sha256 is not null;
create index if not exists ediel_certificate_directory_cache_ediel_idx
  on public.ediel_certificate_directory_cache(ediel_id) where ediel_id is not null;
create index if not exists ediel_certificate_directory_cache_refresh_idx
  on public.ediel_certificate_directory_cache(last_checked_at, lookup_status);

-- Certificate refresh queue for manual and scheduled runs.
create table if not exists public.ediel_certificate_refresh_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null,
  platform_market_actor_id uuid null,
  grid_owner_id uuid null,
  ediel_id text null,
  requested_by uuid null,
  triggered_by text not null check (triggered_by in ('manual','scheduled_30_day','xml_import','backfill','certificate_refresh')),
  status text not null default 'queued' check (status in ('queued','running','completed','failed','skipped')),
  started_at timestamptz null,
  finished_at timestamptz null,
  found_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  valid_count integer not null default 0,
  expired_count integer not null default 0,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ediel_certificate_refresh_jobs_status_idx
  on public.ediel_certificate_refresh_jobs(status, triggered_by, created_at desc);
create index if not exists ediel_certificate_refresh_jobs_actor_idx
  on public.ediel_certificate_refresh_jobs(platform_market_actor_id, status) where platform_market_actor_id is not null;
create index if not exists ediel_certificate_refresh_jobs_grid_owner_idx
  on public.ediel_certificate_refresh_jobs(grid_owner_id, status) where grid_owner_id is not null;

-- Extend grid owners for this hardening batch.
alter table public.grid_owners add column if not exists certificate_valid_to timestamptz;
alter table public.grid_owners add column if not exists not_seen_in_latest_import boolean not null default false;
alter table public.grid_owners add column if not exists last_seen_in_import_at timestamptz;

-- Extend suppliers only when the table exists.
do $$
begin
  if to_regclass('public.electricity_suppliers') is not null then
    alter table public.electricity_suppliers add column if not exists platform_market_actor_id uuid;
    alter table public.electricity_suppliers add column if not exists verification_status text;
    alter table public.electricity_suppliers add column if not exists verification_reasons text[] not null default '{}'::text[];
    alter table public.electricity_suppliers add column if not exists route_status text;
    alter table public.electricity_suppliers add column if not exists certificate_status text;
    alter table public.electricity_suppliers add column if not exists verified_for_customer_flow boolean not null default false;
    alter table public.electricity_suppliers add column if not exists can_start_supplier_switch boolean not null default false;
    alter table public.electricity_suppliers add column if not exists actor_registry_status text;
    alter table public.electricity_suppliers add column if not exists not_seen_in_latest_import boolean not null default false;
    alter table public.electricity_suppliers add column if not exists last_seen_in_import_at timestamptz;
    alter table public.electricity_suppliers add column if not exists verification_checked_at timestamptz;
    alter table public.electricity_suppliers add column if not exists verification_metadata jsonb not null default '{}'::jsonb;
    create index if not exists electricity_suppliers_platform_actor_idx on public.electricity_suppliers(platform_market_actor_id) where platform_market_actor_id is not null;
  end if;
end $$;

-- Normalization helpers.
create or replace function public.gridex_normalize_actor_text(p_value text)
returns text
language sql
immutable
as $$
  select nullif(lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g')), '')
$$;

create or replace function public.gridex_normalize_actor_identifier(p_identifier_type text, p_value text)
returns text
language sql
immutable
as $$
  select case
    when p_value is null then null
    when lower(coalesce(p_identifier_type, '')) in ('orgno','org_number','orgnr','organization_number') then nullif(regexp_replace(p_value, '\D', '', 'g'), '')
    when lower(coalesce(p_identifier_type, '')) in ('email','smtp','smtp_email','communication_address') then nullif(lower(btrim(p_value)), '')
    when lower(coalesce(p_identifier_type, '')) in ('subaddress','sub_address') then nullif(btrim(p_value), '')
    else nullif(upper(btrim(p_value)), '')
  end
$$;

-- Idempotent conflict helper used by SQL and TS code.
create or replace function public.gridex_create_actor_registry_conflict(
  p_company_id uuid,
  p_import_run_id uuid,
  p_import_item_id uuid,
  p_actor_id uuid,
  p_grid_owner_id uuid,
  p_supplier_id uuid,
  p_conflict_type text,
  p_severity text,
  p_title text,
  p_message text,
  p_current_data jsonb default '{}'::jsonb,
  p_incoming_data jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fingerprint text;
  v_id uuid;
begin
  v_fingerprint := encode(digest(coalesce(p_conflict_type, '') || '|' || coalesce(p_actor_id::text, '') || '|' || coalesce(p_grid_owner_id::text, '') || '|' || coalesce(p_supplier_id::text, '') || '|' || coalesce(p_current_data::text, '{}') || '|' || coalesce(p_incoming_data::text, '{}'), 'sha256'), 'hex');

  insert into public.actor_registry_conflicts(
    company_id, import_run_id, import_item_id, actor_id, grid_owner_id, supplier_id,
    conflict_type, severity, status, title, message, current_data, incoming_data,
    conflict_fingerprint, metadata
  ) values (
    p_company_id, p_import_run_id, p_import_item_id, p_actor_id, p_grid_owner_id, p_supplier_id,
    coalesce(p_conflict_type, 'manual_review_required'), coalesce(p_severity, 'blocking'), 'open',
    coalesce(p_title, 'Behöver granskas'), coalesce(p_message, 'Aktörsdata behöver granskas innan den används.'),
    coalesce(p_current_data, '{}'::jsonb), coalesce(p_incoming_data, '{}'::jsonb),
    v_fingerprint, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (conflict_fingerprint) where conflict_fingerprint is not null
  do update set
    status = case when actor_registry_conflicts.status in ('resolved','ignored') then actor_registry_conflicts.status else 'open' end,
    updated_at = now(),
    metadata = coalesce(actor_registry_conflicts.metadata, '{}'::jsonb) || excluded.metadata
  returning id into v_id;

  return v_id;
end;
$$;

-- Match a staging item conservatively. It does not apply changes when multiple matches exist.
create or replace function public.gridex_match_actor_registry_item(p_import_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.actor_registry_import_items%rowtype;
  v_matches uuid[] := '{}'::uuid[];
  v_match uuid;
  v_reason text;
  v_count int;
begin
  select * into v_item from public.actor_registry_import_items where id = p_import_item_id for update;
  if not found then
    raise exception 'actor registry import item not found';
  end if;

  if v_item.normalized_ediel_id is not null then
    select array_agg(distinct actor_id) into v_matches
    from public.platform_actor_identifiers
    where lower(identifier_type) in ('edielid','ediel_id')
      and public.gridex_normalize_actor_identifier('ediel_id', identifier_value) = v_item.normalized_ediel_id;
    v_reason := 'ediel_id';
  end if;

  if coalesce(array_length(v_matches, 1), 0) = 0 and v_item.normalized_org_no is not null then
    select array_agg(distinct id) into v_matches
    from public.platform_market_actors
    where public.gridex_normalize_actor_identifier('org_number', org_number) = v_item.normalized_org_no;
    v_reason := 'org_number';
  end if;

  if coalesce(array_length(v_matches, 1), 0) = 0 and v_item.normalized_eic is not null then
    select array_agg(distinct actor_id) into v_matches
    from public.platform_actor_identifiers
    where lower(identifier_type) in ('eic','eic_code')
      and public.gridex_normalize_actor_identifier('eic', identifier_value) = v_item.normalized_eic;
    v_reason := 'eic';
  end if;

  if coalesce(array_length(v_matches, 1), 0) = 0 and v_item.normalized_name is not null then
    select array_agg(id) into v_matches
    from public.platform_market_actors
    where normalized_name = v_item.normalized_name;
    v_reason := 'name_exact';
  end if;

  v_count := coalesce(array_length(v_matches, 1), 0);

  if v_count = 1 then
    v_match := v_matches[1];
    update public.actor_registry_import_items
    set match_status = 'matched', matched_actor_id = v_match, match_confidence = case when v_reason in ('ediel_id','org_number','eic') then 'strong' else 'weak' end,
        match_reason = v_reason, review_required = false, review_reason = null, updated_at = now()
    where id = p_import_item_id;
    return jsonb_build_object('status', 'matched', 'actor_id', v_match, 'reason', v_reason);
  elsif v_count > 1 then
    perform public.gridex_create_actor_registry_conflict(
      v_item.company_id, v_item.import_run_id, v_item.id, null, null, null,
      'duplicate_' || coalesce(v_reason, 'actor'), 'blocking', 'Dubblett i aktörsregistret',
      'Flera aktörer matchar samma starka identifierare. Systemet applicerar inte importposten automatiskt.',
      jsonb_build_object('matching_actor_ids', v_matches, 'match_reason', v_reason),
      v_item.normalized_payload,
      jsonb_build_object('function', 'gridex_match_actor_registry_item')
    );
    update public.actor_registry_import_items
    set match_status = 'conflict', review_required = true, review_reason = 'duplicate_' || coalesce(v_reason, 'actor'), updated_at = now()
    where id = p_import_item_id;
    return jsonb_build_object('status', 'conflict', 'reason', v_reason, 'matches', v_matches);
  else
    update public.actor_registry_import_items
    set match_status = 'pending', matched_actor_id = null, match_confidence = 'none', match_reason = 'no_match', updated_at = now()
    where id = p_import_item_id;
    return jsonb_build_object('status', 'no_match');
  end if;
end;
$$;

-- One-row-per-actor duplicate candidate view. Review, never auto-merge.
create or replace view public.actor_registry_duplicate_candidates_v
with (security_invoker = true)
as
with identifiers as (
  select actor_id, lower(identifier_type) as identifier_type, public.gridex_normalize_actor_identifier(identifier_type, identifier_value) as identifier_value
  from public.platform_actor_identifiers
  where nullif(btrim(identifier_value), '') is not null
), dupes as (
  select identifier_type, identifier_value, count(distinct actor_id)::integer as duplicate_count, array_agg(distinct actor_id order by actor_id) as actor_ids
  from identifiers
  where identifier_type in ('edielid','ediel_id','orgno','org_number','orgnr','eic','eic_code')
    and identifier_value is not null
  group by identifier_type, identifier_value
  having count(distinct actor_id) > 1
), names as (
  select 'name'::text as identifier_type, normalized_name as identifier_value, count(*)::integer as duplicate_count, array_agg(id order by id) as actor_ids
  from public.platform_market_actors
  where normalized_name is not null
  group by normalized_name
  having count(*) > 1
)
select
  identifier_type as duplicate_type,
  identifier_value as duplicate_key,
  duplicate_count,
  actor_ids,
  case when identifier_type in ('edielid','ediel_id') then 'blocking' else 'warning' end as severity,
  'manual_review_required'::text as suggested_action
from dupes
union all
select identifier_type, identifier_value, duplicate_count, actor_ids, 'warning', 'manual_review_required'
from names;

-- Actor readiness view used by UI, cron and outbound/customer-flow guards.
create or replace view public.actor_readiness_status
with (security_invoker = true)
as
with ids as (
  select
    actor_id,
    max(identifier_value) filter (where lower(identifier_type) in ('edielid','ediel_id')) as ediel_id,
    bool_or(coalesce(is_verified, false)) filter (where lower(identifier_type) in ('edielid','ediel_id')) as ediel_id_verified,
    max(identifier_value) filter (where lower(identifier_type) in ('orgno','org_number','orgnr')) as org_number,
    max(identifier_value) filter (where lower(identifier_type) in ('eic','eic_code')) as eic
  from public.platform_actor_identifiers
  group by actor_id
), roles as (
  select actor_id,
    array_agg(distinct lower(actor_role) order by lower(actor_role)) as roles,
    bool_or(lower(actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')) as has_grid_owner_role,
    bool_or(lower(actor_role) in ('electricity_supplier','power_supplier','supplier','elhandelsbolag','balance_responsible','balansansvarig')) as has_supplier_role
  from public.platform_actor_roles
  where coalesce(is_active, true) = true
  group by actor_id
), routes as (
  select actor_id,
    count(*) filter (where upper(message_family)='PRODAT' and coalesce(status,'')='active')::integer as prodat_route_count,
    count(*) filter (where upper(message_family)='UTILTS' and coalesce(status,'')='active')::integer as utilts_route_count,
    bool_or(upper(message_family)='PRODAT' and coalesce(status,'')='active' and coalesce(is_verified,false)) as has_prodat_route,
    bool_or(upper(message_family)='UTILTS' and coalesce(status,'')='active' and coalesce(is_verified,false)) as has_utilts_route,
    bool_or(coalesce(status,'')='active' and (nullif(btrim(coalesce(subaddress,'')), '') is not null or coalesce((metadata->>'subaddress_status'), '') = 'not_required_confirmed')) as has_safe_subaddress,
    bool_or(nullif(btrim(coalesce(communication_address,'')), '') is not null) as has_contact_path
  from public.platform_actor_routes
  group by actor_id
), certs as (
  select distinct on (actor_id, environment, purpose)
    actor_id, environment, purpose, status, fingerprint_sha256, ediel_id, valid_to, raw_certificate_pem
  from public.platform_actor_certificates
  where environment = 'production'
    and purpose in ('encryption','signing')
    and coalesce(status, '') in ('valid','expires_soon')
    and valid_to is not null
    and valid_to > now()
    and nullif(btrim(coalesce(raw_certificate_pem,'')), '') is not null
  order by actor_id, environment, purpose, valid_to desc nulls last
), conflicts as (
  select actor_id, count(*)::integer as open_blocking_conflicts
  from public.actor_registry_conflicts
  where status = 'open' and severity = 'blocking' and actor_id is not null
  group by actor_id
)
select
  a.id as platform_market_actor_id,
  a.name as actor_name,
  a.legal_name,
  coalesce(ids.org_number, a.org_number) as org_number,
  ids.ediel_id,
  ids.eic,
  coalesce(roles.roles, '{}'::text[]) as roles,
  coalesce(roles.has_grid_owner_role, false) as has_grid_owner_role,
  coalesce(roles.has_supplier_role, false) as has_supplier_role,
  coalesce(routes.has_prodat_route, false) as has_prodat_route,
  coalesce(routes.has_utilts_route, false) as has_utilts_route,
  coalesce(routes.has_safe_subaddress, false) as has_safe_subaddress,
  coalesce(routes.has_contact_path, false) as has_contact_path,
  coalesce(certs.fingerprint_sha256 is not null and (certs.ediel_id is null or certs.ediel_id = ids.ediel_id), false) as has_valid_prodat_certificate,
  coalesce(certs.fingerprint_sha256 is not null and (certs.ediel_id is null or certs.ediel_id = ids.ediel_id), false) as has_valid_utilts_certificate,
  coalesce(conflicts.open_blocking_conflicts, 0) as open_blocking_conflicts,
  (
    coalesce(routes.has_prodat_route, false)
    and coalesce(routes.has_safe_subaddress, false)
    and coalesce(routes.has_contact_path, false)
    and coalesce(certs.fingerprint_sha256 is not null and (certs.ediel_id is null or certs.ediel_id = ids.ediel_id), false)
    and coalesce(conflicts.open_blocking_conflicts, 0) = 0
  ) as can_use_for_prodat,
  (
    coalesce(routes.has_utilts_route, false)
    and coalesce(routes.has_safe_subaddress, false)
    and coalesce(routes.has_contact_path, false)
    and coalesce(conflicts.open_blocking_conflicts, 0) = 0
  ) as can_use_for_utilts,
  (
    coalesce(roles.has_grid_owner_role, false)
    and coalesce(routes.has_prodat_route, false)
    and coalesce(routes.has_safe_subaddress, false)
    and coalesce(routes.has_contact_path, false)
    and coalesce(certs.fingerprint_sha256 is not null and (certs.ediel_id is null or certs.ediel_id = ids.ediel_id), false)
    and coalesce(conflicts.open_blocking_conflicts, 0) = 0
  ) as can_start_supplier_switch,
  array_remove(array[
    case when ids.ediel_id is null then 'missing_ediel_id' end,
    case when not coalesce(routes.has_prodat_route, false) then 'missing_prodat_route' end,
    case when not coalesce(routes.has_safe_subaddress, false) then 'unsafe_or_missing_subaddress' end,
    case when not coalesce(routes.has_contact_path, false) then 'missing_contact_path' end,
    case when not coalesce(certs.fingerprint_sha256 is not null and (certs.ediel_id is null or certs.ediel_id = ids.ediel_id), false) then 'missing_or_invalid_certificate' end,
    case when coalesce(conflicts.open_blocking_conflicts, 0) > 0 then 'open_blocking_conflicts' end
  ], null) as blocking_reasons,
  now() as checked_at
from public.platform_market_actors a
left join ids on ids.actor_id = a.id
left join roles on roles.actor_id = a.id
left join routes on routes.actor_id = a.id
left join certs on certs.actor_id = a.id and certs.environment = 'production' and certs.purpose = 'encryption'
left join conflicts on conflicts.actor_id = a.id;

-- Recalculate persisted grid-owner/supplier readiness from views.
create or replace function public.gridex_recalculate_actor_readiness(p_platform_market_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grid_updated int := 0;
  v_supplier_updated int := 0;
begin
  update public.grid_owners g
  set verified_for_customer_flow = coalesce(r.can_start_supplier_switch, false),
      supplier_switch_ready = coalesce(r.can_start_supplier_switch, false),
      prodat_ready_for_customer_flow = coalesce(r.can_use_for_prodat, false),
      utilts_ready_for_metering_flow = coalesce(r.can_use_for_utilts, false),
      actor_registry_status = case when coalesce(r.can_start_supplier_switch, false) then 'verified' else 'under_review' end,
      verification_status = case
        when coalesce(r.can_start_supplier_switch, false) then 'verified'
        when 'open_blocking_conflicts' = any(r.blocking_reasons) then 'unresolved_duplicate'
        when 'missing_or_invalid_certificate' = any(r.blocking_reasons) then 'needs_certificate'
        when 'missing_prodat_route' = any(r.blocking_reasons) then 'needs_route'
        when 'unsafe_or_missing_subaddress' = any(r.blocking_reasons) then 'needs_subaddress'
        when 'missing_contact_path' = any(r.blocking_reasons) then 'needs_contact'
        when 'missing_ediel_id' = any(r.blocking_reasons) then 'needs_ediel_id'
        else 'unknown'
      end,
      verification_reasons = coalesce(r.blocking_reasons, '{}'::text[]),
      verification_checked_at = now(),
      verified_at = case when coalesce(r.can_start_supplier_switch, false) then coalesce(g.verified_at, now()) else g.verified_at end,
      updated_at = now()
  from public.actor_readiness_status r
  where g.platform_market_actor_id = r.platform_market_actor_id
    and (p_platform_market_actor_id is null or r.platform_market_actor_id = p_platform_market_actor_id);
  get diagnostics v_grid_updated = row_count;

  if to_regclass('public.electricity_suppliers') is not null then
    update public.electricity_suppliers s
    set verified_for_customer_flow = coalesce(r.can_use_for_prodat, false),
        can_start_supplier_switch = coalesce(r.can_use_for_prodat, false),
        actor_registry_status = case when coalesce(r.can_use_for_prodat, false) then 'verified' else 'under_review' end,
        verification_status = case when coalesce(r.can_use_for_prodat, false) then 'verified' else 'needs_review' end,
        verification_reasons = coalesce(r.blocking_reasons, '{}'::text[]),
        verification_checked_at = now(),
        verification_metadata = coalesce(s.verification_metadata, '{}'::jsonb) || jsonb_build_object('readiness_checked_at', now())
    from public.actor_readiness_status r
    where s.platform_market_actor_id = r.platform_market_actor_id
      and (p_platform_market_actor_id is null or r.platform_market_actor_id = p_platform_market_actor_id);
    get diagnostics v_supplier_updated = row_count;
  end if;

  return jsonb_build_object('ok', true, 'grid_owners_updated', v_grid_updated, 'suppliers_updated', v_supplier_updated);
end;
$$;

-- Candidates for the 30-day certificate refresh worker.
create or replace view public.ediel_certificate_refresh_candidates_v
with (security_invoker = true)
as
select
  r.actor_id as platform_market_actor_id,
  g.id as grid_owner_id,
  g.company_id,
  coalesce(g.ediel_id, ids.ediel_id) as ediel_id,
  r.communication_address as smtp_email,
  r.subaddress,
  r.environment,
  max(c.last_checked_at) as last_checked_at,
  max(c.valid_to) as certificate_valid_to,
  coalesce(max(c.status), 'missing') as certificate_status
from public.platform_actor_routes r
left join public.grid_owners g on g.platform_market_actor_id = r.actor_id
left join (
  select actor_id, max(identifier_value) filter (where lower(identifier_type) in ('edielid','ediel_id')) as ediel_id
  from public.platform_actor_identifiers group by actor_id
) ids on ids.actor_id = r.actor_id
left join public.platform_actor_certificates c on c.actor_id = r.actor_id and c.environment = r.environment and c.purpose = 'encryption'
where upper(r.message_family) = 'PRODAT'
  and r.environment = 'production'
  and coalesce(r.status, '') = 'active'
  and nullif(btrim(coalesce(r.communication_address, '')), '') is not null
  and (g.id is null or coalesce(g.is_active, true) = true)
group by r.actor_id, g.id, g.company_id, coalesce(g.ediel_id, ids.ediel_id), r.communication_address, r.subaddress, r.environment
having max(c.last_checked_at) is null
    or max(c.last_checked_at) < now() - interval '30 days'
    or max(c.valid_to) is null
    or max(c.valid_to) < now() + interval '45 days'
    or coalesce(max(c.status), 'missing') in ('missing','expired','invalid','unknown');

-- RLS for new tables. Platform/service writes only; signed-in admins can read.
alter table public.actor_registry_import_runs enable row level security;
alter table public.actor_registry_import_items enable row level security;
alter table public.actor_registry_conflicts enable row level security;
alter table public.ediel_certificate_refresh_jobs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='actor_registry_import_runs' and policyname='actor_registry_import_runs_read') then
    create policy actor_registry_import_runs_read on public.actor_registry_import_runs for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='actor_registry_import_runs' and policyname='actor_registry_import_runs_write') then
    create policy actor_registry_import_runs_write on public.actor_registry_import_runs for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='actor_registry_import_items' and policyname='actor_registry_import_items_read') then
    create policy actor_registry_import_items_read on public.actor_registry_import_items for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='actor_registry_import_items' and policyname='actor_registry_import_items_write') then
    create policy actor_registry_import_items_write on public.actor_registry_import_items for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='actor_registry_conflicts' and policyname='actor_registry_conflicts_read') then
    create policy actor_registry_conflicts_read on public.actor_registry_conflicts for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='actor_registry_conflicts' and policyname='actor_registry_conflicts_write') then
    create policy actor_registry_conflicts_write on public.actor_registry_conflicts for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_certificate_refresh_jobs' and policyname='ediel_certificate_refresh_jobs_read') then
    create policy ediel_certificate_refresh_jobs_read on public.ediel_certificate_refresh_jobs for select using (auth.role() = 'service_role' or auth.uid() is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='ediel_certificate_refresh_jobs' and policyname='ediel_certificate_refresh_jobs_write') then
    create policy ediel_certificate_refresh_jobs_write on public.ediel_certificate_refresh_jobs for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
end $$;

grant select on public.actor_registry_import_runs, public.actor_registry_import_items, public.actor_registry_conflicts, public.actor_readiness_status, public.actor_registry_duplicate_candidates_v, public.ediel_certificate_refresh_jobs, public.ediel_certificate_refresh_candidates_v to authenticated;
grant execute on function public.gridex_create_actor_registry_conflict(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.gridex_match_actor_registry_item(uuid) to authenticated;
grant execute on function public.gridex_recalculate_actor_readiness(uuid) to authenticated;
