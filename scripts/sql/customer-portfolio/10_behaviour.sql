\set ON_ERROR_STOP 1
insert into white_label_platforms(id,name) values ('00000000-0000-0000-0000-0000000000a1','Elklart'),('00000000-0000-0000-0000-0000000000a2','Other');
insert into companies(id,name,white_label_platform_id) values ('00000000-0000-0000-0000-00000000000a','A','00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-00000000000b','B',null);
-- users: u1 tenant A member, u2 white-label viewer of Elklart, u3 superadmin, u4 viewer of Other
insert into company_memberships values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a');
insert into white_label_platform_memberships values ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000002','viewer'),('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000004','owner');
insert into platform_admins values ('00000000-0000-0000-0000-000000000003');
insert into customer_supply_periods(company_id,customer_id,metering_point_id,start_date,end_date,status) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000d1','2026-01-15',null,'active'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000d2','2026-03-01','2026-05-20','ended'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000d3','2026-05-10',null,'active'),
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000d4','2026-05-10',null,'cancelled'),
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000c9','00000000-0000-0000-0000-0000000000d9','2026-01-01',null,'active');
insert into powers_of_attorney(company_id,status,signed_at,created_at) values ('00000000-0000-0000-0000-00000000000a','signed','2026-05-03','2026-05-02'),('00000000-0000-0000-0000-00000000000a','draft',null,'2026-05-20');
insert into grid_owner_data_requests(company_id,request_scope,status,requested_period_start,requested_at) values
 ('00000000-0000-0000-0000-00000000000a','meter_values','sent','2025-05-01','2026-05-05'),
 ('00000000-0000-0000-0000-00000000000a','meter_values','failed','2026-05-01','2026-05-06');
insert into metering_values(company_id,metering_point_id,value_kwh,period_start)
 select '00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000d1', case when extract(month from d)=6 then 300 else 100 end, d
 from generate_series('2025-06-01'::timestamptz,'2026-05-01','1 month') d;

-- tenant A member
set role authenticated; set test.uid='00000000-0000-0000-0000-000000000001';
select 'A May' t, * from gridex_customer_portfolio_summary('00000000-0000-0000-0000-00000000000a','2026-05-01','2026-05-31');
select 'A fc' t, month, month_index, forecast_kwh, metering_points, points_with_history from gridex_customer_portfolio_forecast('00000000-0000-0000-0000-00000000000a','2026-06-15') where month_index<=3;
do $$ begin perform gridex_customer_portfolio_summary('00000000-0000-0000-0000-00000000000b','2026-05-01','2026-05-31'); raise exception 'LEAK B'; exception when insufficient_privilege then raise notice 'ok: A member denied B'; end $$;
do $$ begin perform gridex_whitelabel_portfolio_overview('00000000-0000-0000-0000-0000000000a1','2026-05-01'); raise exception 'LEAK WL'; exception when insufficient_privilege then raise notice 'ok: tenant denied WL overview'; end $$;
do $$ begin perform gridex_assign_company_to_whitelabel('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000a1'); raise exception 'ASSIGN LEAK'; exception when insufficient_privilege then raise notice 'ok: tenant cannot assign'; end $$;
do $$ begin perform gridex_snapshot_customer_portfolio_month('00000000-0000-0000-0000-00000000000a','2026-05-01'); raise exception 'SNAP LEAK'; exception when insufficient_privilege then raise notice 'ok: snapshot service only'; end $$;
reset role;
-- whitelabel viewer
set role authenticated; set test.uid='00000000-0000-0000-0000-000000000002';
select 'WL list' t, * from gridex_list_readable_whitelabel_platforms();
select 'WL overview' t, company_name, active_customers, new_customers, churned_customers, poa_requested, metering_requests_total, forecast_month_kwh, forecast_12m_kwh from gridex_whitelabel_portfolio_overview('00000000-0000-0000-0000-0000000000a1','2026-05-01');
select 'WL reads A' t, active_customers from gridex_customer_portfolio_summary('00000000-0000-0000-0000-00000000000a','2026-05-01','2026-05-01');
do $$ begin perform gridex_customer_portfolio_summary('00000000-0000-0000-0000-00000000000b','2026-05-01','2026-05-31'); raise exception 'LEAK'; exception when insufficient_privilege then raise notice 'ok: WL denied non-member company'; end $$;
do $$ begin perform gridex_whitelabel_portfolio_overview('00000000-0000-0000-0000-0000000000a2','2026-05-01'); raise exception 'LEAK'; exception when insufficient_privilege then raise notice 'ok: WL denied other platform'; end $$;
do $$ begin update companies set white_label_platform_id = null where id='00000000-0000-0000-0000-00000000000a'; raise exception 'LEAK'; exception when insufficient_privilege then raise notice 'ok: WL cannot write companies'; end $$;
reset role;
-- direct update by non-admin hits trigger (as owner but with uid of tenant)
set test.uid='00000000-0000-0000-0000-000000000001'; set test.role='authenticated';
do $$ begin update companies set white_label_platform_id = null where id='00000000-0000-0000-0000-00000000000a'; raise exception 'TRIGGER LEAK'; exception when insufficient_privilege then raise notice 'ok: trigger blocks'; end $$;
reset test.uid; reset test.role;
-- superadmin assigns B via RPC; audit written
set role authenticated; set test.uid='00000000-0000-0000-0000-000000000003'; set test.role='authenticated';
select 'assign' t, white_label_platform_id from gridex_assign_company_to_whitelabel('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000a1');
reset role;
select 'audit' t, action from audit_logs;
set role service_role; set test.role='service_role'; set test.uid='';
select 'snap1' t, active_customers, new_customers, churned_customers, net_change, churn_rate, forecast_kwh from gridex_snapshot_customer_portfolio_month('00000000-0000-0000-0000-00000000000a','2026-05-17');
select 'snap2' t, active_customers, churned_customers from gridex_snapshot_customer_portfolio_month('00000000-0000-0000-0000-00000000000a','2026-05-01');
reset role;
select 'rows' t, count(*) from company_monthly_metrics;
