-- Read-only production readiness report for the canonical market/resolver/quote/billing flow.
-- Prerequisite: migrations through 20260724223000_market_price_api_documentation_completion.sql.
begin transaction read only;

select 'latest_spot_price_rows' as metric, count(*)::bigint as finding_count
from public.gridex_latest_spot_price_by_area_v
union all
select 'spot_interval_gaps', count(*) from public.gridex_spot_interval_gaps_v
union all
select 'spot_interval_overlaps', count(*) from public.gridex_spot_interval_overlaps_v
union all
select 'spot_incomplete_days', count(*) from public.gridex_spot_incomplete_days_v
union all
select 'spot_complete_unlocked_periods', count(*) from public.gridex_spot_complete_unlocked_periods_v
union all
select 'locked_spot_periods_missing_evidence', count(*) from public.gridex_locked_spot_periods_missing_evidence_v
union all
select 'stale_market_previews', count(*) from public.gridex_stale_market_previews_v
union all
select 'market_price_readiness_blockers', coalesce(sum(issue_count),0)::bigint from public.gridex_market_price_readiness_v where status='blocking'
union all
select 'stuck_spot_import_jobs', count(*) from public.gridex_stuck_spot_import_jobs_v
union all
select 'old_geodata_versions', count(*) from public.gridex_old_geodata_versions_v
union all
select 'resolutions_needing_review', count(*) from public.gridex_energy_resolutions_needing_review_v
union all
select 'metering_points_incomplete_area_context', count(*) from public.gridex_metering_points_incomplete_area_context_v
union all
select 'quotes_without_canonical_resolution', count(*) from public.gridex_quotes_without_canonical_resolution_v
union all
select 'signed_or_active_contracts_missing_price_snapshot', count(*) from public.gridex_customer_contracts_missing_price_snapshot_v
union all
select 'customer_identity_duplicate_candidates', count(*) from public.gridex_customer_identity_duplicate_candidates_v
union all
select 'open_canonical_remediation_items', count(*) from public.canonical_energy_remediation_queue where status in ('open','in_review')
union all
select 'open_audit_event_repairs', count(*) from public.canonical_energy_remediation_queue where status in ('open','in_review') and remediation_type='audit_event_repair'
order by metric;

select * from public.gridex_latest_spot_price_by_area_v order by price_area;
select * from public.gridex_spot_incomplete_days_v order by price_date desc, price_area limit 200;
select * from public.gridex_spot_complete_unlocked_periods_v order by period_key desc, price_area limit 200;
select * from public.gridex_locked_spot_periods_missing_evidence_v order by period_key desc, price_area limit 200;
select * from public.gridex_stale_market_previews_v order by stale_after limit 200;
select * from public.gridex_market_price_readiness_v order by case status when 'blocking' then 0 when 'warning' then 1 else 2 end,check_key;
select * from public.gridex_market_preview_coverage_v where status='active' order by price_area,reference_period;
select * from public.gridex_stuck_spot_import_jobs_v order by started_at nulls last limit 200;
select * from public.gridex_old_geodata_versions_v order by age desc limit 50;
select * from public.gridex_energy_resolutions_needing_review_v order by created_at desc limit 200;
select * from public.gridex_metering_points_incomplete_area_context_v order by company_id,id limit 200;
select * from public.gridex_quotes_without_canonical_resolution_v order by created_at desc limit 200;
select * from public.gridex_customer_contracts_missing_price_snapshot_v order by created_at desc limit 200;
select * from public.gridex_customer_identity_duplicate_candidates_v order by company_id,match_type,match_key limit 200;
select * from public.canonical_energy_remediation_queue
where status in ('open','in_review')
order by case severity when 'critical' then 0 when 'blocking' then 1 else 2 end,created_at
limit 300;

rollback;
