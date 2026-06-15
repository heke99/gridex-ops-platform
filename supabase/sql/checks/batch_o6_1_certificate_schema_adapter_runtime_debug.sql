-- Batch O6.1 runtime diagnostics: confirms jobs finish and platform_actor_certificates uses actor_id/raw_certificate_pem.

select
  created_at,
  finished_at,
  triggered_by,
  job_status,
  stage,
  job_ediel_id,
  grid_owner_name,
  grid_owner_ediel_id,
  grid_owner_actor_id,
  platform_market_actor_id,
  found_count,
  inserted_count,
  updated_count,
  valid_count,
  expired_count,
  error_message,
  lookup_addresses,
  lookup_sources,
  errors,
  lookup_results,
  usable_actor_certificate_rows,
  newest_actor_certificate_valid_to
from public.gridex_certificate_lookup_runtime_debug_v
order by created_at desc
limit 50;

select
  pma.name as actor_name,
  pma.id as actor_id,
  coalesce(pma.ediel_id, pai.identifier_value) as ediel_id,
  pac.environment,
  pac.certificate_type,
  pac.purpose,
  pac.status,
  pac.valid_to,
  pac.fingerprint_sha256,
  case
    when pac.raw_certificate_pem is not null and length(pac.raw_certificate_pem) > 0 then true
    else false
  end as has_pem,
  pac.source,
  pac.last_checked_at
from public.platform_actor_certificates pac
left join public.platform_market_actors pma on pma.id = pac.actor_id
left join public.platform_actor_identifiers pai
  on pai.actor_id = pma.id
 and lower(pai.identifier_type) in ('ediel_id', 'edielid', 'ediel')
order by pac.created_at desc
limit 50;

select
  status,
  count(*) as jobs,
  count(*) filter (where finished_at is null) as unfinished_jobs,
  count(*) filter (where metadata ? 'lookupResults') as jobs_with_lookup_results,
  count(*) filter (where found_count > 0) as found_jobs,
  count(*) filter (where valid_count > 0) as valid_jobs,
  count(*) filter (where error_message is not null) as jobs_with_error_message
from public.ediel_certificate_refresh_jobs
where created_at > now() - interval '2 hours'
group by status
order by jobs desc;

select
  ediel_id,
  smtp_email,
  lookup_status,
  source,
  count(*) as cache_rows,
  count(*) filter (where coalesce(certificate_pem, public_certificate_pem) is not null and length(coalesce(certificate_pem, public_certificate_pem)) > 0) as with_pem,
  max(coalesce(valid_to, not_after)) as newest_valid_to,
  max(coalesce(last_checked_at, fetched_at)) as last_checked_at
from public.ediel_certificate_directory_cache
group by ediel_id, smtp_email, lookup_status, source
order by max(coalesce(last_checked_at, fetched_at)) desc nulls last
limit 100;
