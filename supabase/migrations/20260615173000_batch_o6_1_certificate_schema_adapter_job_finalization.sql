-- Batch O6.1: Certificate schema adapter + refresh job finalization diagnostics
-- Purpose: keep the production schema stable (actor_id/raw_certificate_pem), expose clear diagnostics,
-- and prevent stale running certificate refresh jobs from hiding failed LDAP/sync attempts.

-- Keep existing production schema; add only missing compatibility columns that are part of the canonical table.
alter table public.platform_actor_certificates add column if not exists actor_id uuid;
alter table public.platform_actor_certificates add column if not exists raw_certificate_pem text;
alter table public.platform_actor_certificates add column if not exists purpose text not null default 'encryption';
alter table public.platform_actor_certificates add column if not exists certificate_type text not null default 'smime';
alter table public.platform_actor_certificates add column if not exists last_checked_at timestamptz;
alter table public.platform_actor_certificates add column if not exists next_check_at timestamptz;
alter table public.platform_actor_certificates add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists platform_actor_certificates_actor_env_purpose_idx
  on public.platform_actor_certificates(actor_id, environment, purpose, status, valid_to desc)
  where actor_id is not null;

create index if not exists platform_actor_certificates_actor_fingerprint_idx
  on public.platform_actor_certificates(actor_id, fingerprint_sha256)
  where actor_id is not null and fingerprint_sha256 is not null;

-- Mark old abandoned runs so the UI and diagnostics do not keep showing them as active forever.
update public.ediel_certificate_refresh_jobs
set status = 'failed',
    error_message = coalesce(error_message, 'Stale running job markerad som failed efter avbruten certifikatsökning.'),
    finished_at = coalesce(finished_at, now()),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'staleCleanupAt', now(),
      'staleCleanupReason', 'job_was_left_running_without_final_status',
      'batch', 'O6.1'
    ),
    updated_at = now()
where status = 'running'
  and created_at < now() - interval '10 minutes';

create or replace view public.gridex_certificate_lookup_runtime_debug_v
with (security_invoker = true)
as
select
  -- Keep the original Batch O6 column order first. Postgres CREATE OR REPLACE VIEW cannot rename/reorder existing columns.
  j.created_at,
  j.triggered_by,
  j.status as job_status,
  j.ediel_id as job_ediel_id,
  j.grid_owner_id,
  j.platform_market_actor_id,
  j.found_count,
  j.inserted_count,
  j.updated_count,
  j.valid_count,
  j.expired_count,
  j.error_message,
  j.metadata->'lookupAddresses' as lookup_addresses,
  j.metadata->'lookupSources' as lookup_sources,
  j.metadata->'routeSources' as route_sources,
  j.metadata->'errors' as errors,
  j.metadata->'lookupResults' as lookup_results,
  j.metadata as job_metadata,
  g.name as grid_owner_name,
  g.ediel_id as grid_owner_ediel_id,
  g.platform_market_actor_id as grid_owner_actor_id,
  g.certificate_status as grid_owner_certificate_status,
  g.verification_status as grid_owner_verification_status,
  -- O6.1 additions are appended at the end to remain backward-compatible with the existing view.
  j.finished_at,
  j.metadata->'stage' as stage,
  count(pac.id) filter (
    where pac.actor_id = j.platform_market_actor_id
      and pac.environment = 'production'
      and pac.purpose = 'encryption'
      and pac.status in ('valid','expires_soon')
      and pac.valid_to > now()
      and nullif(btrim(coalesce(pac.raw_certificate_pem,'')), '') is not null
  ) as usable_actor_certificate_rows,
  max(pac.valid_to) filter (where pac.actor_id = j.platform_market_actor_id) as newest_actor_certificate_valid_to
from public.ediel_certificate_refresh_jobs j
left join public.grid_owners g on g.id = j.grid_owner_id
left join public.platform_actor_certificates pac on pac.actor_id = j.platform_market_actor_id
group by
  j.id,
  j.created_at,
  j.triggered_by,
  j.status,
  j.ediel_id,
  j.grid_owner_id,
  j.platform_market_actor_id,
  j.found_count,
  j.inserted_count,
  j.updated_count,
  j.valid_count,
  j.expired_count,
  j.error_message,
  j.metadata,
  j.finished_at,
  g.name,
  g.ediel_id,
  g.platform_market_actor_id,
  g.certificate_status,
  g.verification_status;

grant select on public.gridex_certificate_lookup_runtime_debug_v to authenticated, service_role;
