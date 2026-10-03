\set ON_ERROR_STOP 1
-- Run after 10_behaviour.sql and 20261003131000_customer_portfolio_phase2.sql.
reset role; reset test.uid; reset test.role;
insert into metering_points values ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000000a','SE3'),('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-00000000000a',null);
insert into customers(id, company_id, full_name) values ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000a','Anna Kund');
insert into customer_contracts(company_id, customer_id, ends_at, termination_reason) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c2','2026-05-20','price');
insert into powers_of_attorney(company_id, customer_id, status, valid_to) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','signed', current_date + 10),('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','signed', current_date + 90);

set role authenticated; set test.uid='00000000-0000-0000-0000-000000000001'; set test.role='authenticated';
select 'churn' t, * from gridex_customer_portfolio_churn_reasons('00000000-0000-0000-0000-00000000000a','2026-05-01','2026-05-31');
select 'zones' t, * from gridex_customer_portfolio_bidding_zones('00000000-0000-0000-0000-00000000000a','2026-06-15');
select 'cohort' t, cohort_month, customers, retained_1m from gridex_customer_portfolio_cohorts('00000000-0000-0000-0000-00000000000a', 12) where cohort_month = '2026-03-01';
select 'poa_exp' t, customer_name, days_left from gridex_customer_portfolio_expiring_poa('00000000-0000-0000-0000-00000000000a', 30);
select 'active' t, * from gridex_customer_portfolio_active_counts(array['00000000-0000-0000-0000-00000000000a']::uuid[], '2026-05-31');
do $$ begin perform gridex_customer_portfolio_active_counts(array['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b']::uuid[], '2026-05-31'); raise exception 'LEAK active batch'; exception when insufficient_privilege then raise notice 'ok: active batch denies foreign tenant'; end $$;
do $$ begin perform gridex_customer_portfolio_cohorts('00000000-0000-0000-0000-00000000000b', 12); raise exception 'LEAK cohort'; exception when insufficient_privilege then raise notice 'ok: cohorts deny foreign tenant'; end $$;
do $$ begin insert into customer_portfolio_forecast_snapshots(company_id, as_of_month, month, month_index) values ('00000000-0000-0000-0000-00000000000a','2026-05-01','2026-05-01',1); raise exception 'LEAK write'; exception when insufficient_privilege then raise notice 'ok: snapshots not writable by tenant'; end $$;
reset role;

-- snapshot idempotency and past-month immutability
set role service_role; set test.role='service_role'; set test.uid='';
select gridex_snapshot_customer_portfolio_month('00000000-0000-0000-0000-00000000000a','2026-05-01') is not null as s1;
select count(*) as first_count, sum(forecast_kwh) as first_sum from customer_portfolio_forecast_snapshots where as_of_month='2026-05-01' \gset
reset role;
insert into metering_values(company_id,metering_point_id,value_kwh,period_start) values ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000d1', 99999, '2026-04-15');
set role service_role;
select gridex_snapshot_customer_portfolio_month('00000000-0000-0000-0000-00000000000a','2026-05-01') is not null as s2;
select 'snap_past' t, count(*) = :first_count as same_rows, sum(forecast_kwh) = :first_sum as unchanged from customer_portfolio_forecast_snapshots where as_of_month='2026-05-01';
reset role; reset test.uid; reset test.role;
set role authenticated; set test.uid='00000000-0000-0000-0000-000000000001'; set test.role='authenticated';
select 'accuracy' t, month, forecast_kwh, actual_kwh from gridex_customer_portfolio_forecast_accuracy('00000000-0000-0000-0000-00000000000a','2026-05-01','2026-05-01');
select 'cached' t, count(*) from gridex_customer_portfolio_forecast('00000000-0000-0000-0000-00000000000a','2026-05-10');
reset role;
