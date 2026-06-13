-- Batch: Actor Auto-Readiness, Certificate Backfill & Auto-send Guard
-- Purpose: make actor/routes/certificates self-healing while keeping auto_send_allowed gated by explicit readiness.

create extension if not exists pgcrypto with schema extensions;

-- 1) Certificate inventory per platform actor. Public certificate material may be stored; private keys must never be stored here.
create table if not exists public.platform_actor_certificates (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.platform_market_actors(id) on delete cascade,
  ediel_id text,
  environment text not null default 'production' check (environment in ('test','production')),
  certificate_type text not null default 'smime' check (certificate_type in ('smime','cms','x509','unknown')),
  purpose text not null default 'encryption' check (purpose in ('encryption','signing','transport','unknown')),
  subject text,
  issuer text,
  serial_number text,
  fingerprint_sha256 text,
  valid_from timestamptz,
  valid_to timestamptz,
  status text not null default 'unknown' check (status in ('valid','expires_soon','expired','missing','mismatch','invalid','unknown')),
  source text not null default 'auto_readiness',
  source_url text,
  raw_certificate_pem text,
  metadata jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists platform_actor_certificates_fingerprint_uidx
  on public.platform_actor_certificates(fingerprint_sha256)
  where fingerprint_sha256 is not null;

create index if not exists platform_actor_certificates_actor_lookup_idx
  on public.platform_actor_certificates(actor_id, environment, purpose, status, next_check_at);

create index if not exists platform_actor_certificates_ediel_lookup_idx
  on public.platform_actor_certificates(ediel_id, environment, purpose, status)
  where ediel_id is not null;

-- 2) Readiness run and per-check audit trail.
create table if not exists public.platform_actor_readiness_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null default 'manual' check (run_type in ('nightly_backfill','certificate_refresh','manual_actor_check','xml_import_followup','auto_send_apply','manual')),
  status text not null default 'running' check (status in ('running','completed','completed_with_issues','failed','cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  checked_actor_count integer not null default 0,
  checked_route_count integer not null default 0,
  checked_certificate_count integer not null default 0,
  auto_enabled_count integer not null default 0,
  auto_disabled_count integer not null default 0,
  failed_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_actor_readiness_runs_lookup_idx
  on public.platform_actor_readiness_runs(run_type, status, started_at desc);

create table if not exists public.platform_actor_readiness_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.platform_actor_readiness_runs(id) on delete cascade,
  actor_id uuid references public.platform_market_actors(id) on delete cascade,
  route_id uuid references public.platform_actor_routes(id) on delete cascade,
  certificate_id uuid references public.platform_actor_certificates(id) on delete set null,
  check_type text not null,
  status text not null default 'unknown' check (status in ('passed','warning','blocking','unknown')),
  blocking_reasons text[] not null default '{}'::text[],
  warnings text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  next_check_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists platform_actor_readiness_checks_actor_idx
  on public.platform_actor_readiness_checks(actor_id, check_type, checked_at desc);

create index if not exists platform_actor_readiness_checks_route_idx
  on public.platform_actor_readiness_checks(route_id, check_type, checked_at desc);

-- 3) Keep grid owner to market actor bridge available for resolver/readiness.
alter table public.platform_grid_owners add column if not exists market_actor_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'platform_grid_owners_market_actor_id_fkey'
  ) then
    alter table public.platform_grid_owners
      add constraint platform_grid_owners_market_actor_id_fkey
      foreign key (market_actor_id)
      references public.platform_market_actors(id)
      on delete set null;
  end if;
end $$;

create index if not exists platform_grid_owners_market_actor_id_idx
  on public.platform_grid_owners(market_actor_id);

-- 4) Canonical send-readiness view. auto_send_allowed is per route/message family, not global per actor.
create or replace view public.platform_actor_send_readiness_v
with (security_invoker = true)
as
with actor_roles as (
  select actor_id, array_agg(distinct actor_role order by actor_role) as roles
  from public.platform_actor_roles
  where coalesce(is_active, true) = true
  group by actor_id
), actor_ids as (
  select actor_id, max(identifier_value) filter (where identifier_type = 'EdielId') as ediel_id,
         bool_or(coalesce(is_verified, false)) filter (where identifier_type = 'EdielId') as ediel_id_verified
  from public.platform_actor_identifiers
  group by actor_id
), latest_cert as (
  select distinct on (c.actor_id, c.environment, c.purpose)
    c.id,
    c.actor_id,
    c.ediel_id,
    c.environment,
    c.purpose,
    c.status,
    c.fingerprint_sha256,
    c.subject,
    c.issuer,
    c.serial_number,
    c.valid_from,
    c.valid_to,
    c.last_checked_at,
    c.next_check_at,
    c.metadata
  from public.platform_actor_certificates c
  where c.purpose in ('encryption','signing')
  order by c.actor_id, c.environment, c.purpose,
           case c.status when 'valid' then 0 when 'expires_soon' then 1 when 'unknown' then 2 else 3 end,
           c.last_checked_at desc nulls last,
           c.updated_at desc
), route_base as (
  select
    r.id as route_id,
    r.actor_id,
    a.name as actor_name,
    a.legal_name,
    a.org_number,
    a.status as actor_status,
    a.match_status,
    a.visible_to_tenants,
    coalesce(ar.roles, '{}'::text[]) as actor_roles,
    ai.ediel_id,
    coalesce(ai.ediel_id_verified, false) as ediel_id_verified,
    r.message_family,
    r.application_reference,
    r.environment,
    r.subaddress,
    r.communication_type,
    r.communication_address,
    r.party_id,
    r.interchange_party_id,
    r.status as route_status,
    r.is_verified as route_verified,
    r.auto_send_allowed,
    r.source as route_source,
    r.valid_to as route_valid_to,
    r.metadata as route_metadata,
    case
      when upper(r.message_family) = 'PRODAT' and r.environment = 'production' then true
      when coalesce(r.metadata->>'requires_certificate', '') in ('true','1','yes') then true
      when coalesce(r.metadata->>'transport_security_mode', '') in ('encrypted','smime','s_mime','cms') then true
      else false
    end as requires_certificate
  from public.platform_actor_routes r
  join public.platform_market_actors a on a.id = r.actor_id
  left join actor_roles ar on ar.actor_id = r.actor_id
  left join actor_ids ai on ai.actor_id = r.actor_id
)
select
  rb.actor_id,
  rb.actor_name,
  rb.legal_name,
  rb.org_number,
  rb.actor_status,
  rb.match_status,
  rb.visible_to_tenants,
  rb.actor_roles,
  rb.ediel_id,
  rb.ediel_id_verified,
  rb.route_id,
  rb.message_family,
  rb.application_reference,
  rb.environment,
  rb.subaddress,
  rb.communication_type,
  rb.communication_address,
  rb.party_id,
  rb.interchange_party_id,
  rb.route_status,
  rb.route_verified,
  rb.auto_send_allowed,
  rb.route_source,
  rb.route_valid_to,
  rb.requires_certificate,
  lc.id as certificate_id,
  lc.status as certificate_status,
  lc.fingerprint_sha256 as certificate_fingerprint_sha256,
  lc.subject as certificate_subject,
  lc.issuer as certificate_issuer,
  lc.serial_number as certificate_serial_number,
  lc.valid_from as certificate_valid_from,
  lc.valid_to as certificate_valid_to,
  lc.last_checked_at as certificate_last_checked_at,
  lc.next_check_at as certificate_next_check_at,
  array_remove(array[
    case when rb.actor_status <> 'active' then 'actor_not_active' end,
    case when rb.ediel_id is null then 'missing_ediel_id' end,
    case when rb.ediel_id is not null and rb.ediel_id_verified = false then 'ediel_id_not_verified' end,
    case when rb.route_status <> 'active' then 'route_not_active' end,
    case when rb.route_verified = false then 'route_not_verified' end,
    case when nullif(trim(coalesce(rb.communication_address, '')), '') is null then 'missing_smtp_address' end,
    case when nullif(trim(coalesce(rb.party_id, '')), '') is null then 'missing_party_id' end,
    case when nullif(trim(coalesce(rb.interchange_party_id, '')), '') is null then 'missing_interchange_party_id' end,
    case when rb.ediel_id is not null and rb.party_id is not null and rb.party_id <> rb.ediel_id then 'party_id_mismatch' end,
    case when rb.ediel_id is not null and rb.interchange_party_id is not null and rb.interchange_party_id <> rb.ediel_id then 'interchange_party_id_mismatch' end,
    case when rb.route_valid_to is not null and rb.route_valid_to < current_date then 'route_expired' end,
    case when rb.requires_certificate and lc.id is null then 'missing_certificate' end,
    case when rb.requires_certificate and lc.status = 'missing' then 'missing_certificate' end,
    case when rb.requires_certificate and lc.status = 'expired' then 'expired_certificate' end,
    case when rb.requires_certificate and lc.status = 'invalid' then 'invalid_certificate' end,
    case when rb.requires_certificate and lc.status = 'mismatch' then 'certificate_mismatch' end,
    case when rb.requires_certificate and lc.status = 'unknown' then 'certificate_unknown' end,
    case when rb.requires_certificate and lc.ediel_id is not null and rb.ediel_id is not null and lc.ediel_id <> rb.ediel_id then 'certificate_ediel_mismatch' end,
    case when rb.environment not in ('test','production') then 'wrong_environment' end
  ], null) as blocking_reasons,
  array_remove(array[
    case when rb.requires_certificate and lc.status = 'expires_soon' then 'certificate_expires_soon' end,
    case when rb.requires_certificate and lc.next_check_at is not null and lc.next_check_at <= now() then 'certificate_check_due' end,
    case when rb.auto_send_allowed = true and (lc.status in ('expires_soon','unknown') or lc.id is null) then 'auto_send_should_be_rechecked' end
  ], null) as warnings,
  case
    when cardinality(array_remove(array[
      case when rb.actor_status <> 'active' then 'actor_not_active' end,
      case when rb.ediel_id is null then 'missing_ediel_id' end,
      case when rb.ediel_id is not null and rb.ediel_id_verified = false then 'ediel_id_not_verified' end,
      case when rb.route_status <> 'active' then 'route_not_active' end,
      case when rb.route_verified = false then 'route_not_verified' end,
      case when nullif(trim(coalesce(rb.communication_address, '')), '') is null then 'missing_smtp_address' end,
      case when nullif(trim(coalesce(rb.party_id, '')), '') is null then 'missing_party_id' end,
      case when nullif(trim(coalesce(rb.interchange_party_id, '')), '') is null then 'missing_interchange_party_id' end,
      case when rb.ediel_id is not null and rb.party_id is not null and rb.party_id <> rb.ediel_id then 'party_id_mismatch' end,
      case when rb.ediel_id is not null and rb.interchange_party_id is not null and rb.interchange_party_id <> rb.ediel_id then 'interchange_party_id_mismatch' end,
      case when rb.route_valid_to is not null and rb.route_valid_to < current_date then 'route_expired' end,
      case when rb.requires_certificate and lc.id is null then 'missing_certificate' end,
      case when rb.requires_certificate and lc.status in ('missing','expired','invalid','mismatch','unknown') then lc.status || '_certificate' end,
      case when rb.requires_certificate and lc.ediel_id is not null and rb.ediel_id is not null and lc.ediel_id <> rb.ediel_id then 'certificate_ediel_mismatch' end
    ], null)) = 0 then 'ready_for_auto_send'
    when rb.requires_certificate and (lc.id is null or lc.status = 'missing') then 'missing_certificate'
    when rb.requires_certificate and lc.status = 'expired' then 'expired_certificate'
    when rb.requires_certificate and lc.status = 'expires_soon' then 'certificate_expires_soon'
    when rb.route_verified = false or rb.route_status <> 'active' then 'route_not_verified'
    when nullif(trim(coalesce(rb.communication_address, '')), '') is null then 'missing_smtp_address'
    when rb.ediel_id is not null and (rb.party_id <> rb.ediel_id or rb.interchange_party_id <> rb.ediel_id) then 'party_id_mismatch'
    else 'needs_manual_review'
  end as readiness_status,
  greatest(
    coalesce(lc.last_checked_at, '-infinity'::timestamptz),
    coalesce((rb.route_metadata->>'auto_readiness_checked_at')::timestamptz, '-infinity'::timestamptz)
  ) as last_checked_at,
  coalesce(lc.next_check_at, now()) as next_check_at
from route_base rb
left join latest_cert lc
  on lc.actor_id = rb.actor_id
 and lc.environment = rb.environment
 and lc.purpose = 'encryption';

revoke all on public.platform_actor_send_readiness_v from anon;

-- 5) Certificate status refresh. The actual external certificate lookup is handled by server code/import; this function normalizes stored cert state.
create or replace function public.gridex_refresh_actor_certificate_statuses(p_run_type text default 'certificate_refresh')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_checked int := 0;
  v_missing int := 0;
begin
  insert into public.platform_actor_readiness_runs(run_type, status, metadata)
  values (coalesce(p_run_type, 'certificate_refresh'), 'running', jsonb_build_object('source', 'gridex_refresh_actor_certificate_statuses'))
  returning id into v_run_id;

  update public.platform_actor_certificates c
  set status = case
      when c.status = 'missing' then 'missing'
      when c.valid_to is not null and c.valid_to < now() then 'expired'
      when c.valid_to is not null and c.valid_to <= now() + interval '45 days' then 'expires_soon'
      when c.fingerprint_sha256 is not null and (c.valid_to is null or c.valid_to >= now()) then 'valid'
      else coalesce(nullif(c.status, ''), 'unknown')
    end,
    last_checked_at = coalesce(c.last_checked_at, now()),
    next_check_at = case
      when c.valid_to is not null and c.valid_to <= now() + interval '45 days' then now() + interval '7 days'
      else now() + interval '30 days'
    end,
    updated_at = now(),
    metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('status_refreshed_at', now(), 'status_refreshed_by', 'system')
  where c.next_check_at is null or c.next_check_at <= now() or c.last_checked_at is null;

  get diagnostics v_checked = row_count;

  insert into public.platform_actor_certificates(actor_id, ediel_id, environment, certificate_type, purpose, status, source, metadata, last_checked_at, next_check_at)
  select distinct v.actor_id, v.ediel_id, v.environment, 'unknown', 'encryption', 'missing', 'auto_readiness_missing_certificate',
         jsonb_build_object('reason', 'PRODAT production route requires receiver certificate before auto-send', 'created_by', 'gridex_refresh_actor_certificate_statuses'),
         now(), now() + interval '30 days'
  from public.platform_actor_send_readiness_v v
  where v.requires_certificate = true
    and v.certificate_id is null
    and not exists (
      select 1
      from public.platform_actor_certificates existing
      where existing.actor_id = v.actor_id
        and existing.environment = v.environment
        and existing.purpose = 'encryption'
        and existing.status in ('missing','unknown')
    );

  get diagnostics v_missing = row_count;

  update public.platform_actor_readiness_runs
  set status = 'completed', finished_at = now(), checked_certificate_count = v_checked + v_missing,
      metadata = metadata || jsonb_build_object('certificates_refreshed', v_checked, 'missing_certificate_placeholders_created', v_missing)
  where id = v_run_id;

  return jsonb_build_object('ok', true, 'run_id', v_run_id, 'certificates_refreshed', v_checked, 'missing_certificate_placeholders_created', v_missing);
exception when others then
  if v_run_id is not null then
    update public.platform_actor_readiness_runs
    set status = 'failed', finished_at = now(), failed_count = 1, metadata = metadata || jsonb_build_object('error', sqlerrm)
    where id = v_run_id;
  end if;
  raise;
end;
$$;

-- 6) Actor/route backfill from already imported XML registry data. This is intentionally conservative for auto-send.
create or replace function public.gridex_actor_readiness_backfill(p_run_type text default 'nightly_backfill')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_actors int := 0;
  v_routes int := 0;
  v_certs jsonb;
begin
  insert into public.platform_actor_readiness_runs(run_type, status, metadata)
  values (coalesce(p_run_type, 'nightly_backfill'), 'running', jsonb_build_object('source', 'gridex_actor_readiness_backfill'))
  returning id into v_run_id;

  update public.platform_actor_identifiers i
  set is_verified = true,
      metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object('auto_verified_from_registry_at', now(), 'auto_readiness_run_id', v_run_id),
      updated_at = now()
  where i.identifier_type in ('EdielId','EIC','SvKId','OrgNo')
    and coalesce(i.source, '') in ('companies_xml','xml_actor_registry','xml_import','svk_esett_actor_registry_match')
    and coalesce(i.is_verified, false) = false;

  update public.platform_market_actors a
  set status = 'active',
      match_status = case when exists (
        select 1 from public.platform_actor_identifiers i
        where i.actor_id = a.id and i.identifier_type in ('EdielId','EIC','SvKId') and i.is_verified = true
      ) then 'verified' else a.match_status end,
      visible_to_tenants = case when exists (
        select 1 from public.platform_actor_roles r
        where r.actor_id = a.id and r.actor_role in ('grid_owner','electricity_supplier') and r.is_active = true
      ) then true else a.visible_to_tenants end,
      verified_at = case when a.verified_at is null and exists (
        select 1 from public.platform_actor_identifiers i
        where i.actor_id = a.id and i.identifier_type in ('EdielId','EIC','SvKId') and i.is_verified = true
      ) then now() else a.verified_at end,
      metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object('auto_readiness_backfilled_at', now(), 'auto_readiness_run_id', v_run_id),
      updated_at = now()
  where a.status in ('active','needs_review')
    and exists (select 1 from public.platform_actor_roles r where r.actor_id = a.id and r.is_active = true);

  get diagnostics v_actors = row_count;

  update public.platform_actor_routes r
  set status = 'active',
      is_verified = true,
      auto_send_allowed = false,
      metadata = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'verification_status', 'auto_verified_from_actor_registry',
        'auto_readiness_checked_at', now(),
        'auto_readiness_run_id', v_run_id,
        'auto_send_policy', 'requires_send_readiness_before_enable'
      ),
      updated_at = now()
  from public.platform_actor_identifiers i
  where i.actor_id = r.actor_id
    and i.identifier_type = 'EdielId'
    and i.is_verified = true
    and r.status in ('needs_review','active')
    and coalesce(r.is_verified, false) = false
    and upper(r.message_family) in ('PRODAT','UTILTS')
    and r.environment in ('test','production')
    and upper(coalesce(r.communication_type, 'SMTP')) = 'SMTP'
    and nullif(trim(coalesce(r.communication_address, '')), '') is not null
    and r.party_id = i.identifier_value
    and r.interchange_party_id = i.identifier_value
    and (r.valid_to is null or r.valid_to >= current_date);

  get diagnostics v_routes = row_count;

  v_certs := public.gridex_refresh_actor_certificate_statuses('certificate_refresh');
  perform public.gridex_apply_actor_auto_send_readiness(v_run_id);

  update public.platform_actor_readiness_runs
  set status = 'completed', finished_at = now(), checked_actor_count = v_actors, checked_route_count = v_routes,
      metadata = metadata || jsonb_build_object('cert_refresh', v_certs)
  where id = v_run_id;

  return jsonb_build_object('ok', true, 'run_id', v_run_id, 'actors_backfilled', v_actors, 'routes_verified', v_routes, 'cert_refresh', v_certs);
exception when others then
  if v_run_id is not null then
    update public.platform_actor_readiness_runs
    set status = 'failed', finished_at = now(), failed_count = 1, metadata = metadata || jsonb_build_object('error', sqlerrm)
    where id = v_run_id;
  end if;
  raise;
end;
$$;

-- 7) Apply auto-send from readiness view and auto-disable unsafe routes.
create or replace function public.gridex_apply_actor_auto_send_readiness(p_existing_run_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
  v_enabled int := 0;
  v_disabled int := 0;
begin
  if p_existing_run_id is null then
    insert into public.platform_actor_readiness_runs(run_type, status, metadata)
    values ('auto_send_apply', 'running', jsonb_build_object('source', 'gridex_apply_actor_auto_send_readiness'))
    returning id into v_run_id;
  else
    v_run_id := p_existing_run_id;
  end if;

  update public.platform_actor_routes r
  set auto_send_allowed = true,
      metadata = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'auto_send_enabled_at', now(),
        'auto_send_enabled_by', 'system',
        'auto_send_enabled_reason', 'all_readiness_checks_passed',
        'readiness_run_id', v_run_id,
        'certificate_fingerprint', v.certificate_fingerprint_sha256
      ),
      updated_at = now()
  from public.platform_actor_send_readiness_v v
  where v.route_id = r.id
    and v.readiness_status = 'ready_for_auto_send'
    and coalesce(r.auto_send_allowed, false) = false;

  get diagnostics v_enabled = row_count;

  update public.platform_actor_routes r
  set auto_send_allowed = false,
      metadata = coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
        'auto_send_disabled_at', now(),
        'auto_send_disabled_by', 'system',
        'auto_send_disabled_reason', 'readiness_not_green',
        'readiness_run_id', v_run_id,
        'blocking_reasons', v.blocking_reasons,
        'warnings', v.warnings
      ),
      updated_at = now()
  from public.platform_actor_send_readiness_v v
  where v.route_id = r.id
    and v.readiness_status <> 'ready_for_auto_send'
    and coalesce(r.auto_send_allowed, false) = true;

  get diagnostics v_disabled = row_count;

  insert into public.platform_actor_readiness_checks(run_id, actor_id, route_id, certificate_id, check_type, status, blocking_reasons, warnings, metadata, checked_at, next_check_at)
  select v_run_id, v.actor_id, v.route_id, v.certificate_id, 'auto_send',
         case when v.readiness_status = 'ready_for_auto_send' then 'passed'
              when cardinality(v.blocking_reasons) > 0 then 'blocking'
              when cardinality(v.warnings) > 0 then 'warning'
              else 'unknown' end,
         v.blocking_reasons,
         v.warnings,
         jsonb_build_object('readiness_status', v.readiness_status, 'message_family', v.message_family, 'environment', v.environment),
         now(), v.next_check_at
  from public.platform_actor_send_readiness_v v;

  if p_existing_run_id is null then
    update public.platform_actor_readiness_runs
    set status = 'completed', finished_at = now(), auto_enabled_count = v_enabled, auto_disabled_count = v_disabled,
        metadata = metadata || jsonb_build_object('auto_enabled_count', v_enabled, 'auto_disabled_count', v_disabled)
    where id = v_run_id;
  else
    update public.platform_actor_readiness_runs
    set auto_enabled_count = auto_enabled_count + v_enabled,
        auto_disabled_count = auto_disabled_count + v_disabled,
        metadata = metadata || jsonb_build_object('auto_enabled_count', v_enabled, 'auto_disabled_count', v_disabled)
    where id = v_run_id;
  end if;

  return jsonb_build_object('ok', true, 'run_id', v_run_id, 'auto_enabled_count', v_enabled, 'auto_disabled_count', v_disabled);
exception when others then
  if v_run_id is not null then
    update public.platform_actor_readiness_runs
    set status = 'failed', finished_at = now(), failed_count = 1, metadata = metadata || jsonb_build_object('error', sqlerrm)
    where id = v_run_id;
  end if;
  raise;
end;
$$;

-- 8) RLS/audit-safe access. Writes are platform/service-only; logged server functions use service role.
alter table public.platform_actor_certificates enable row level security;
alter table public.platform_actor_readiness_runs enable row level security;
alter table public.platform_actor_readiness_checks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_certificates' and policyname='platform_actor_certificates_read') then
    create policy platform_actor_certificates_read on public.platform_actor_certificates for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_certificates' and policyname='platform_actor_certificates_platform_write') then
    create policy platform_actor_certificates_platform_write on public.platform_actor_certificates for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_readiness_runs' and policyname='platform_actor_readiness_runs_read') then
    create policy platform_actor_readiness_runs_read on public.platform_actor_readiness_runs for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_readiness_runs' and policyname='platform_actor_readiness_runs_platform_write') then
    create policy platform_actor_readiness_runs_platform_write on public.platform_actor_readiness_runs for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_readiness_checks' and policyname='platform_actor_readiness_checks_read') then
    create policy platform_actor_readiness_checks_read on public.platform_actor_readiness_checks for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='platform_actor_readiness_checks' and policyname='platform_actor_readiness_checks_platform_write') then
    create policy platform_actor_readiness_checks_platform_write on public.platform_actor_readiness_checks for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
end $$;

revoke all on public.platform_actor_certificates from anon;
revoke all on public.platform_actor_readiness_runs from anon;
revoke all on public.platform_actor_readiness_checks from anon;
