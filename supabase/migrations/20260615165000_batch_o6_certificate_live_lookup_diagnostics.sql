-- Batch O6 hotfix: certificate live lookup diagnostics and cache compatibility.
-- Purpose: manual/bulk certificate lookup must always be traceable even when cache is empty.

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
    lookup_status = coalesce(lookup_status, case when sha256_fingerprint is not null or fingerprint_sha256 is not null then 'found' else 'not_found' end),
    environment = coalesce(environment, 'production'),
    purpose = coalesce(purpose, 'encryption'),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('canonical_backfilled_at', now())
where certificate_pem is null
   or fingerprint_sha256 is null
   or valid_from is null
   or valid_to is null
   or last_checked_at is null
   or lookup_key is null
   or environment is null
   or purpose is null;

create index if not exists ediel_certificate_directory_cache_lookup_status_idx
  on public.ediel_certificate_directory_cache(lookup_status, last_checked_at desc);

create index if not exists ediel_certificate_refresh_jobs_metadata_gin_idx
  on public.ediel_certificate_refresh_jobs using gin (metadata);

create or replace view public.gridex_certificate_lookup_runtime_debug_v
with (security_invoker = true)
as
select
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
  g.verification_status as grid_owner_verification_status
from public.ediel_certificate_refresh_jobs j
left join public.grid_owners g on g.id = j.grid_owner_id;

grant select on public.gridex_certificate_lookup_runtime_debug_v to authenticated, service_role;
