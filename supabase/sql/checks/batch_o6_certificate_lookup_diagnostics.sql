-- Batch O6 certificate lookup diagnostics
-- Run this when "Sök certifikat nu" does not change PRODAT certificate status.

-- 1) Latest manual/scheduled lookup jobs and exact reason if they were skipped/failed.
select
  created_at,
  triggered_by,
  status,
  ediel_id,
  grid_owner_id,
  platform_market_actor_id,
  found_count,
  inserted_count,
  updated_count,
  valid_count,
  expired_count,
  error_message,
  metadata
from public.ediel_certificate_refresh_jobs
order by created_at desc
limit 25;

-- 2) Grid owners that still need certificate, with the route/search prerequisites visible.
select
  g.id as grid_owner_id,
  g.name,
  g.ediel_id,
  g.platform_market_actor_id,
  g.verification_status,
  g.certificate_status,
  g.prodat_route_count,
  g.route_status,
  g.default_prodat_subaddress,
  g.prodat_subaddress_status,
  g.communication_email,
  g.email,
  r.id as route_id,
  r.message_family,
  r.environment,
  r.status as route_status_raw,
  r.is_verified as route_is_verified,
  r.communication_address,
  r.party_id,
  r.interchange_party_id,
  r.subaddress
from public.grid_owners g
left join public.platform_actor_routes r
  on r.actor_id = g.platform_market_actor_id
 and upper(coalesce(r.message_family, '')) = 'PRODAT'
 and coalesce(r.environment, 'production') = 'production'
where coalesce(g.certificate_status, 'saknas') <> 'finns'
order by g.name
limit 200;

-- 3) Routes visible through the canonical send-readiness view.
-- If this returns rows but the old button skipped, route lookup was too strict in TypeScript.
select
  actor_id,
  actor_name,
  ediel_id,
  route_id,
  message_family,
  environment,
  route_status,
  route_verified,
  communication_address,
  subaddress,
  requires_certificate,
  certificate_status,
  certificate_fingerprint_sha256,
  blocking_reasons,
  readiness_status
from public.platform_actor_send_readiness_v
where upper(coalesce(message_family, '')) = 'PRODAT'
  and coalesce(environment, 'production') = 'production'
  and requires_certificate is true
order by actor_name
limit 200;

-- 4) Existing Ediel certificates that could be synced into platform_actor_certificates.
select
  owner_ediel_id,
  owner_party_id,
  environment,
  purpose,
  status,
  encryption_status,
  count(*) as certificate_count,
  max(coalesce(valid_to, certificate_valid_to)) as newest_valid_to,
  count(*) filter (where coalesce(public_certificate_pem, '') <> '') as with_pem
from public.ediel_certificates
where environment = 'production'
  and purpose = 'encryption'
group by owner_ediel_id, owner_party_id, environment, purpose, status, encryption_status
order by newest_valid_to desc nulls last
limit 200;

-- 5) Platform actor certificates after lookup/sync.
select
  actor_id,
  ediel_id,
  environment,
  purpose,
  status,
  source,
  count(*) as certificate_count,
  max(valid_to) as newest_valid_to,
  count(*) filter (where coalesce(raw_certificate_pem, '') <> '') as with_pem
from public.platform_actor_certificates
where environment = 'production'
  and purpose = 'encryption'
group by actor_id, ediel_id, environment, purpose, status, source
order by newest_valid_to desc nulls last
limit 200;

-- 6) Directory cache rows. If this is empty after manual lookup, LDAP/directory returned no usable certificates or lookup route/address was wrong.
select
  smtp_email,
  ediel_id,
  subaddress,
  status,
  lookup_status,
  source,
  count(*) as cache_rows,
  max(coalesce(valid_to, not_after)) as newest_valid_to,
  count(*) filter (where coalesce(certificate_pem, public_certificate_pem, '') <> '') as with_pem,
  max(coalesce(last_checked_at, fetched_at)) as last_checked_at
from public.ediel_certificate_directory_cache
group by smtp_email, ediel_id, subaddress, status, lookup_status, source
order by last_checked_at desc nulls last
limit 200;
