\set ON_ERROR_STOP 1
-- Run after 20_phase2.sql and 20261003150000_portfolio_analytics_rollups_performance.sql.
reset role; reset test.uid; reset test.role;
insert into grid_owners(id, company_id) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a');
update metering_points set customer_id = '00000000-0000-0000-0000-0000000000c1', grid_owner_id = '00000000-0000-0000-0000-0000000000e1'
 where id = '00000000-0000-0000-0000-0000000000d1';
insert into forecast_runs(id, company_id, forecast_type, period_start, period_end, created_at) values
 ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000a', 'consumption', '2026-01-01', '2026-12-31', now() - interval '1 day'),
 ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000000a', 'consumption', '2026-01-01', '2026-12-31', now());
insert into forecast_run_items(company_id, forecast_run_id, customer_id, metering_point_id, grid_owner_id, bidding_zone_code, period_start, forecast_kwh) values
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'SE3', '2026-05-01', 999),
 ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'SE3', '2026-05-01', 120);

set role service_role; set test.role='service_role'; set test.uid='';
select gridex_rebuild_company_analytics_month('00000000-0000-0000-0000-00000000000a', '2026-05-01') ->> 'grid_owners' as owners_1;
select gridex_rebuild_company_analytics_month('00000000-0000-0000-0000-00000000000a', '2026-05-01') ->> 'grid_owners' as owners_2;
reset role;
select 'company' t, actual_kwh, forecast_kwh, metering_values_received from company_monthly_metrics
 where company_id = '00000000-0000-0000-0000-00000000000a' and month = '2026-05-01';
select 'customer' t, actual_kwh, forecast_kwh from customer_monthly_metrics
 where customer_id = '00000000-0000-0000-0000-0000000000c1' and month = '2026-05-01';
select 'zone_se3' t, actual_kwh, forecast_kwh, metering_points_count from bidding_zone_monthly_metrics
 where company_id = '00000000-0000-0000-0000-00000000000a' and bidding_zone_code = 'SE3' and month = '2026-05-01';
select 'owner_rows' t, count(*), max(actual_kwh) from grid_owner_monthly_metrics where month = '2026-05-01';

-- a correction makes the May value non-current: the rollup must drop to zero
update metering_values set is_current = false
 where metering_point_id = '00000000-0000-0000-0000-0000000000d1' and period_start >= '2026-05-01' and period_start < '2026-06-01';
set role service_role; set test.role='service_role';
select gridex_rebuild_metering_monthly_consumption('00000000-0000-0000-0000-00000000000a', '2026-05-01', '2026-05-01') as rebuilt;
reset role;
select 'after_correction' t, kwh, value_count from metering_point_monthly_consumption
 where metering_point_id = '00000000-0000-0000-0000-0000000000d1' and month = '2026-05-01';
set role authenticated; set test.uid='00000000-0000-0000-0000-000000000001'; set test.role='authenticated';
do $$ begin perform gridex_rebuild_company_analytics_month('00000000-0000-0000-0000-00000000000a', '2026-05-01'); raise exception 'LEAK rebuild'; exception when insufficient_privilege then raise notice 'ok: analytics rebuild service only'; end $$;
do $$ begin perform count(*) from metering_point_monthly_consumption; raise exception 'LEAK rollup read'; exception when insufficient_privilege then raise notice 'ok: rollup not readable by tenant'; end $$;
reset role;
