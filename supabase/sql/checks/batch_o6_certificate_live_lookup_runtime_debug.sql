-- Shows whether manual/bulk lookup searched the selected network owner or only 91100.
select
  created_at,
  triggered_by,
  job_status,
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
  lookup_results
from public.gridex_certificate_lookup_runtime_debug_v
order by created_at desc
limit 50;

-- Cache result by looked-up address. lookup_status=not_found means live LDAP was attempted but no cert was returned.
select
  smtp_email,
  ediel_id,
  subaddress,
  lookup_status,
  status,
  source,
  count(*) as cache_rows,
  count(*) filter (where coalesce(certificate_pem, public_certificate_pem) is not null and length(coalesce(certificate_pem, public_certificate_pem)) > 0) as with_pem,
  max(coalesce(valid_to, not_after)) as newest_valid_to,
  max(coalesce(last_checked_at, fetched_at)) as last_checked_at
from public.ediel_certificate_directory_cache
group by smtp_email, ediel_id, subaddress, lookup_status, status, source
order by max(coalesce(last_checked_at, fetched_at)) desc nulls last;

-- Actors/routes still missing usable PRODAT certificate.
select
  platform_market_actor_id,
  actor_name,
  ediel_id,
  roles,
  has_prodat_route,
  has_safe_subaddress,
  has_valid_prodat_certificate,
  can_use_for_prodat,
  can_start_supplier_switch,
  blocking_reasons
from public.actor_readiness_status
where has_prodat_route = true
  and coalesce(has_valid_prodat_certificate, false) = false
order by actor_name
limit 100;
