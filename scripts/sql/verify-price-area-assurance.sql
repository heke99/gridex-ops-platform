-- Run after 20260804173000_price_area_assurance_and_pricing_readiness.sql.
-- Every result set must either be empty or match the expected invariant.

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'customer_site_resolution'
  and column_name in (
    'price_area_assurance_status',
    'price_area_assurance_source',
    'price_area_assurance_confidence',
    'price_area_assurance_source_version',
    'price_area_candidate_count',
    'price_area_unique_count',
    'price_area_evidence'
  )
order by column_name;

select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.customer_site_resolution'::regclass
  and conname like 'customer_site_resolution_price_area_%'
order by conname;

-- Expected: zero rows.
select
  id,
  company_id,
  resolution_status,
  price_area,
  price_area_assurance_status,
  price_area_assurance_source,
  price_area_assurance_confidence,
  price_area_candidate_count,
  price_area_unique_count
from public.customer_site_resolution
where
  price_area_assurance_status in ('verified', 'estimated')
  and (
    price_area is null
    or price_area_assurance_source is null
    or price_area_assurance_confidence <= 0
    or price_area_candidate_count < 1
    or price_area_unique_count <> 1
  );

-- Expected: zero rows. Historical postal rows are not auto-promoted.
select id, company_id, resolution_status, price_area_assurance_status
from public.customer_site_resolution
where resolution_status = 'postal_suggested'
  and coalesce((price_area_evidence ->> 'migration_backfill')::boolean, false)
  and price_area_assurance_status <> 'unresolved';

-- Operational distribution for review.
select
  resolution_status,
  price_area_assurance_status,
  price_area_assurance_source,
  count(*) as rows
from public.customer_site_resolution
group by resolution_status, price_area_assurance_status, price_area_assurance_source
order by resolution_status, price_area_assurance_status, price_area_assurance_source;
