-- Read-only follow-ups. Run each SELECT separately through execute_sql;
-- the connector returns only the final statement result in a multi-query call.
-- No customer names, identifiers, payload values, API keys, or messages are returned.

-- 1. Existence and exact-count query generator for related residual tables.
-- Execute the returned sql separately; absent tables are reported by this query.
with wanted(name) as (values
 ('customer_application_intakes'), ('customer_application_provisioning_steps'),
 ('customer_application_workflow_events'), ('customer_application_workflows'),
 ('customer_onboarding_applications'), ('website_application_review_items'),
 ('dashboard_alerts'), ('facility_data_quality_issues'), ('platform_data_quality_issues'),
 ('grid_owner_data_requests'), ('grid_owner_information_requests'),
 ('supplier_switch_requests'), ('normalized_metering_values'),
 ('metering_value_batches'), ('metering_value_errors'),
 ('customer_monthly_metrics'), ('company_monthly_metrics'), ('grid_owner_monthly_metrics'),
 ('bidding_zone_monthly_metrics'), ('forecast_runs'), ('forecast_run_items'),
 ('integration_api_rate_limit_events'), ('inbound_operation_events'),
 ('platform_usage_events'), ('platform_usage_event_failures')
)
select array_agg(name order by name) filter (where to_regclass('public.' || name) is null) as absent_tables,
       string_agg(format('select %L as table_name, count(*) as exact_count from public.%I', name, name),
                  ' union all ' order by name)
         filter (where to_regclass('public.' || name) is not null) as sql
from wanted;

-- 2. Polymorphic data-quality targets: NULL/unknown types are separated,
-- because their absence is not proof that they should be deleted.
select q.issue_type, q.entity_type, q.status, count(*) as issues,
       count(*) filter (where q.entity_id is null) as null_entity,
       count(*) filter (where q.entity_id is not null and
         case q.entity_type
           when 'metering_point' then not exists
             (select 1 from public.metering_points p where p.id=q.entity_id and p.company_id=q.company_id)
           when 'metering_value' then not exists
             (select 1 from public.metering_values p where p.id=q.entity_id and p.company_id=q.company_id)
           when 'customer' then not exists
             (select 1 from public.customers p where p.id=q.entity_id and p.company_id=q.company_id)
           when 'ediel_message' then not exists
             (select 1 from public.ediel_messages p where p.id=q.entity_id and p.company_id=q.company_id)
           when 'grid_owner_data_request' then not exists
             (select 1 from public.grid_owner_data_requests p where p.id=q.entity_id and p.company_id=q.company_id)
           else false
         end) as known_missing_entity,
       min(q.created_at) as oldest_created_at, max(q.created_at) as newest_created_at
from public.data_quality_issues q
group by q.issue_type, q.entity_type, q.status
order by q.issue_type, q.entity_type, q.status;

-- 3. Existing aggregate alerts do not automatically disappear when issues do.
select alert_type, status, count(*) as alerts,
       count(*) filter (where entity_id is null) as aggregate_alerts,
       min(created_at) as oldest_created_at, max(created_at) as newest_created_at
from public.dashboard_alerts
group by alert_type, status order by alert_type, status;

-- 4. Inspect only explicit test flags and structure, never raw payload values.
-- The name matcher is a weak provenance clue, not authorization for deletion.
select w.source, w.status, w.created_at, w.updated_at,
       w.customer_id is not null as has_customer,
       w.customer_site_id is not null as has_site,
       w.metering_point_id is not null as has_metering_point,
       w.contract_id is not null as has_contract,
       w.intake_id is not null as has_intake,
       coalesce(w.metadata->>'is_test_data' = 'true', false) as metadata_test_flag,
       coalesce(w.payload->>'is_test_data' = 'true', false) as payload_test_flag,
       coalesce(w.payload->'customer'->>'is_test_data' = 'true', false) as customer_payload_test_flag,
       coalesce(c.metadata->>'is_test_data' = 'true', false) as client_test_flag,
       coalesce(c.name ilike '%test%' or c.name ilike '%synthetic%', false) as client_name_test_hint,
       array(select jsonb_object_keys(coalesce(w.metadata, '{}'::jsonb))) as metadata_keys,
       array(select jsonb_object_keys(coalesce(c.metadata, '{}'::jsonb))) as client_metadata_keys
from public.website_customer_applications w
left join public.integration_api_clients c on c.id=w.api_client_id and c.company_id=w.company_id;

-- 5. Current FK ownership; created_* aliases and polymorphic entity_id are
-- deliberately included so their lack of constraints is visible.
select con.conrelid::regclass::text as child_table, con.conname,
       con.confrelid::regclass::text as parent_table,
       pg_get_constraintdef(con.oid) as definition, con.convalidated
from pg_constraint con
where con.contype='f' and con.conrelid in (
  'public.website_customer_applications'::regclass,
  'public.external_contract_intakes'::regclass,
  'public.customer_application_intakes'::regclass,
  'public.data_quality_issues'::regclass,
  'public.dashboard_alerts'::regclass,
  'public.customer_portfolio_forecast_snapshots'::regclass
)
order by child_table, con.conname;

-- 6. Prove duplicate conflict keys using existing rows, without writing test data.
-- The grouping is exactly the five columns used by createDashboardAlert upsert.
with groups as (
  select company_id, alert_type, entity_type, entity_id, status, count(*) as n
  from public.dashboard_alerts
  group by company_id, alert_type, entity_type, entity_id, status
)
select alert_type, status, count(*) as logical_keys, sum(n) as physical_rows,
       sum(n-1) as duplicate_excess, max(n) as largest_duplicate_group,
       count(*) filter (where entity_type is null and entity_id is null) as null_aggregate_keys
from groups
group by alert_type, status order by alert_type, status;

-- 7. Verify whether production uniqueness uses ordinary NULL-distinct semantics.
select con.conname, pg_get_constraintdef(con.oid) as definition, con.convalidated
from pg_constraint con
where con.contype='u'
  and con.conrelid in ('public.dashboard_alerts'::regclass, 'public.data_quality_issues'::regclass)
order by con.conrelid::regclass::text, con.conname;
