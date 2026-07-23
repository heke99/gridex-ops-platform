-- Gridex OPS: read-only readiness checks for spot price and energy resolver.
-- Run in Supabase SQL editor or psql against the target environment.

-- 1. Provider registration and metadata.
select source_key, source_name, base_url, status, metadata, updated_at
from public.spot_price_sources
order by source_key;

-- 2. Latest imported interval per price area.
select
  source,
  price_area,
  max(time_end) as latest_interval_end,
  max(updated_at) as latest_db_update,
  count(*) filter (where time_start >= now() - interval '48 hours') as intervals_last_48h
from public.spot_price_intervals
where source = 'elprisetjustnu'
group by source, price_area
order by price_area;

-- 3. Detect invalid durations or unsupported interval sizes.
select source, price_area, time_start, time_end,
       extract(epoch from (time_end - time_start))/60 as minutes
from public.spot_price_intervals
where time_end <= time_start
   or extract(epoch from (time_end - time_start))/60 not in (15, 60)
order by time_start desc
limit 200;

-- 4. Detect overlaps/gaps in recent intervals.
with ordered as (
  select
    source,
    price_area,
    time_start,
    time_end,
    lag(time_end) over (partition by source, price_area order by time_start) as previous_end
  from public.spot_price_intervals
  where source = 'elprisetjustnu'
    and time_start >= now() - interval '40 days'
)
select *,
       case
         when previous_end < time_start then 'gap'
         when previous_end > time_start then 'overlap'
       end as issue
from ordered
where previous_end is not null
  and previous_end <> time_start
order by price_area, time_start;

-- 5. Daily summary status and interval count for recent days.
select source, price_area, price_date, interval_count, status,
       average_sek_per_kwh, min_sek_per_kwh, max_sek_per_kwh, updated_at
from public.spot_price_daily_summaries
where source = 'elprisetjustnu'
  and price_date >= current_date - 10
order by price_date desc, price_area;

-- 6. Monthly summary readiness. Complete rows that are never locked are highlighted.
select source, price_area, billing_month, interval_count, expected_interval_count,
       status, locked_at, updated_at,
       case
         when status = 'complete' and locked_at is null then 'complete_not_locked'
         when status = 'locked' and locked_at is null then 'invalid_locked_state'
         when interval_count < expected_interval_count then 'coverage_missing'
         else 'ok'
       end as readiness
from public.spot_price_monthly_summaries
where source = 'elprisetjustnu'
order by billing_month desc, price_area;

-- 7. Recent import runs and their errors.
select id, source, billing_month, price_areas, status, trigger_source,
       started_at, finished_at, result_summary, error_log
from public.spot_price_import_runs
order by created_at desc
limit 50;

-- 8. Tenant market source policies that can make complete non-locked rows stale.
select company_id, source_key, enabled, priority, max_age_minutes,
       allow_indicative_latest, supported_resolutions, price_areas,
       forecast_policy, portfolio_policy, last_tested_at, last_success_at, last_error
from public.company_market_price_sources
where enabled = true
order by company_id, priority, source_key;

-- 9. Geodata health.
select * from public.gridex_energy_geodata_health_v;

-- 10. Grid areas without geometry.
select ga.grid_area_code, ga.grid_area_name, ga.price_area, ga.grid_owner_id, ga.grid_owner_name
from public.platform_grid_areas ga
where ga.is_active = true
  and not exists (
    select 1
    from public.platform_grid_area_geometries gg
    where gg.is_active = true
      and (gg.grid_area_id = ga.id or gg.grid_area_code = ga.grid_area_code)
  )
order by ga.grid_area_code;

-- 11. Resolver status distribution and automation readiness.
select resolution_status, automation_allowed, count(*) as rows,
       min(created_at) as oldest, max(created_at) as newest
from public.customer_site_resolution
group by resolution_status, automation_allowed
order by resolution_status, automation_allowed;

-- 12. Recent high-risk resolver outcomes.
select id, company_id, customer_id, customer_site_id, grid_area_code,
       price_area, resolution_status, confidence, automation_allowed,
       next_required_action, source_chain, created_at
from public.customer_site_resolution
where created_at >= now() - interval '14 days'
  and (
    resolution_status in ('postal_suggested','address_resolved','needs_review','failed')
    or automation_allowed = false
  )
order by created_at desc
limit 500;

-- 13. Detect quotes whose stored area differs from linked application resolution.
-- Current schema may not yet have energy_resolution_id on website_contract_quotes;
-- this query documents the target check after the P0 migration.
-- select q.quote_reference, q.company_id, q.price_area as quote_area,
--        r.price_area as resolved_area, q.energy_resolution_id
-- from public.website_contract_quotes q
-- join public.customer_site_resolution r on r.id = q.energy_resolution_id
-- where q.company_id <> r.company_id
--    or q.price_area is distinct from r.price_area;
