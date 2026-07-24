\set ON_ERROR_STOP on
\pset pager off

-- Gridex OPS market-price API post-deployment verification.
-- Run with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-market-price-api-production.sql

select 'migration_columns' as check_name,
       count(*) filter (where column_name in (
         'source_as_of','generated_at','requested_days','included_days','source_resolution'
       )) as found_columns
from information_schema.columns
where table_schema='public' and table_name='market_price_previews';

select 'api_scope' as check_name, count(*) as profile_count
from public.integration_api_client_profiles
where key in ('website_signup','tenant_website')
  and 'website_market_prices.read'=any(coalesce(default_scopes,'{}'::text[]));

select
  source,
  price_area,
  price_date,
  status,
  interval_count,
  expected_interval_count,
  covered_duration_minutes,
  expected_duration_minutes,
  provider_fetched_at,
  verified_at
from public.spot_price_daily_summaries
where source='elprisetjustnu'
  and price_date >= (current_date - 35)
order by price_area,price_date desc;

select
  provider,
  price_area,
  reference_period,
  period_start,
  period_end,
  requested_days,
  included_days,
  fallback_used,
  fallback_reason,
  source_as_of,
  generated_at,
  stale_after,
  status
from public.market_price_previews
where provider='elprisetjustnu' and status='active'
order by price_area,reference_period;

select *
from public.gridex_market_preview_coverage_v
order by price_area,reference_period;

select *
from public.gridex_market_price_readiness_v
order by check_key;

select *
from public.gridex_ops_health_checks_v3()
where check_key like 'spot_%'
order by check_key;

select
  company_id,
  source_key,
  enabled,
  priority,
  max_age_minutes,
  allow_indicative_latest,
  supported_resolutions,
  price_areas
from public.company_market_price_sources
where enabled=true
order by company_id,priority,source_key;

select
  company_id,
  profile_key,
  status,
  scopes
from public.integration_api_clients
where status='active'
  and (
    profile_key in ('website_signup','tenant_website')
    or 'website_quotes.write'=any(coalesce(scopes,'{}'::text[]))
  )
order by company_id,profile_key;
