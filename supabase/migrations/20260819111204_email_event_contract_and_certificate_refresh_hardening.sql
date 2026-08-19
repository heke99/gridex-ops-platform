-- Harden certificate refresh job lifecycle without enabling any external delivery.
update public.ediel_certificate_refresh_jobs
set status = 'failed',
    finished_at = coalesce(finished_at, now()),
    error_message = coalesce(nullif(error_message, ''), 'Stale certificate refresh reclaimed after exceeding 30 minute lease.'),
    updated_at = now()
where status = 'running'
  and started_at < now() - interval '30 minutes';

create unique index if not exists ediel_certificate_refresh_jobs_one_running_actor_idx
  on public.ediel_certificate_refresh_jobs (platform_market_actor_id)
  where status = 'running' and platform_market_actor_id is not null;

create unique index if not exists ediel_certificate_refresh_jobs_one_running_grid_owner_idx
  on public.ediel_certificate_refresh_jobs (grid_owner_id)
  where status = 'running' and platform_market_actor_id is null and grid_owner_id is not null;

create index if not exists ediel_certificate_refresh_jobs_status_started_idx
  on public.ediel_certificate_refresh_jobs (status, started_at desc);

-- Canonicalize stale recipient certificate status from actual validity timestamps.
update public.ediel_certificates
set status = 'expired',
    encryption_status = 'expired',
    updated_at = now()
where usage = 'outbound_recipient'
  and purpose in ('encryption', 'both')
  and coalesce(valid_to, certificate_valid_to) is not null
  and coalesce(valid_to, certificate_valid_to) <= now()
  and (status is distinct from 'expired' or encryption_status is distinct from 'expired');
