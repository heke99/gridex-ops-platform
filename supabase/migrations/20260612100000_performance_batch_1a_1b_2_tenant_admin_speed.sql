-- Performance Batch 1A + 1B + 2
-- Tenant/admin speed foundation with summary views and safe indexes.
-- No RLS policy widening, no role changes, no Ediel/billing rule changes.

create index if not exists external_contract_intakes_company_status_created_perf_idx
  on public.external_contract_intakes(company_id, status, created_at desc);

create index if not exists customer_operation_tasks_company_status_created_perf_idx
  on public.customer_operation_tasks(company_id, status, created_at desc);

create index if not exists supplier_switch_requests_company_status_created_perf_idx
  on public.supplier_switch_requests(company_id, status, created_at desc);

create index if not exists grid_owner_data_requests_company_status_created_perf_idx
  on public.grid_owner_data_requests(company_id, status, created_at desc);

create index if not exists outbound_requests_company_status_created_perf_idx
  on public.outbound_requests(company_id, status, created_at desc);

create index if not exists billing_underlays_company_status_created_perf_idx
  on public.billing_underlays(company_id, status, created_at desc);

create index if not exists customer_sites_company_customer_created_perf_idx
  on public.customer_sites(company_id, customer_id, created_at desc);

create index if not exists metering_points_company_customer_site_created_perf_idx
  on public.metering_points(company_id, customer_id, site_id, created_at desc);

create index if not exists customer_contracts_company_customer_updated_perf_idx
  on public.customer_contracts(company_id, customer_id, updated_at desc, created_at desc);

create or replace view public.company_dashboard_summary_v
with (security_invoker = true)
as
select
  c.id as company_id,
  c.name as company_name,
  (select count(*) from public.customers x where x.company_id = c.id and coalesce(x.source, '') <> 'ediel_portal_test' and coalesce(x.status, '') not in ('archived','deleted','deleted_test_only','pending_deletion')) as customers_total,
  (select count(*) from public.customer_contracts x where x.company_id = c.id) as contracts_total,
  (select count(*) from public.customer_sites x where x.company_id = c.id) as sites_total,
  (select count(*) from public.metering_points x where x.company_id = c.id) as metering_points_total,
  (select count(*) from public.customer_operation_tasks x where x.company_id = c.id and x.status = 'open') as open_tasks,
  (select count(*) from public.grid_owner_data_requests x where x.company_id = c.id and x.status in ('sent','waiting_response','queued','pending')) as open_grid_owner_requests,
  (select count(*) from public.supplier_switch_requests x where x.company_id = c.id and x.status in ('open','draft','queued','submitted','accepted','cancellation_requested','cancellation_sent','manual_followup_required')) as open_switches,
  (select count(*) from public.outbound_requests x where x.company_id = c.id) as outbound_requests_total,
  (select count(*) from public.metering_values x where x.company_id = c.id) as metering_values_total,
  (select count(*) from public.billing_underlays x where x.company_id = c.id) as billing_underlays_total,
  (select count(*) from public.supplier_switch_requests x where x.company_id = c.id and x.status in ('draft','queued','submitted','accepted','cancellation_requested','cancellation_sent','manual_followup_required')) as ongoing_supplier_switches,
  (select count(*) from public.grid_owner_data_requests x where x.company_id = c.id and x.status in ('sent','waiting_response','queued')) as waiting_for_grid_owner,
  (select count(*) from public.ediel_messages x where x.company_id = c.id and x.ack_outcome = 'negative') as negative_acknowledgements,
  (select count(*) from public.data_quality_issues x where x.company_id = c.id and x.status = 'open' and x.issue_type = 'missing_metering_values') as missing_metering_values,
  (select count(*) from public.customer_operation_tasks x where x.company_id = c.id and x.status in ('open','in_progress','blocked')) as customers_action_required,
  (select count(*) from public.metering_values x where x.company_id = c.id and x.created_at >= now() - interval '7 days') as latest_metering_values,
  (select count(*) from public.customer_contracts x where x.company_id = c.id and x.ends_at >= current_date and x.ends_at <= current_date + interval '30 days') as upcoming_terminations,
  (select count(*) from public.external_contract_intakes x where x.company_id = c.id and x.status in ('needs_review','partially_created','failed')) as pending_customer_applications,
  (select count(*) from public.billing_underlays x where x.company_id = c.id and coalesce(x.readiness_status, x.status) in ('blocked','failed','needs_review')) as billing_blocked_or_failed,
  (select count(*) from public.integration_api_requests x where x.company_id = c.id and coalesce(x.status_code, 200) >= 400) as api_errors,
  (select count(*) from public.webhook_deliveries x where x.company_id = c.id and x.status in ('failed','dead','dead_letter','retrying')) as webhook_failures,
  (select coalesce(sum(issue_count), 0) from public.gridex_company_launch_blocker_reasons_v r where r.company_id = c.id and r.issue_count > 0) as customers_blocked_or_data_issues,
  (select count(*) from public.gridex_route_readiness_v x where x.readiness_status in ('critical_missing_route','recommended_missing_route','not_sendable','needs_review')) as route_missing_or_not_ready
from public.companies c;

revoke all on public.company_dashboard_summary_v from anon;
grant select on public.company_dashboard_summary_v to authenticated;

create or replace view public.company_customer_intake_queue_v
with (security_invoker = true)
as
select
  i.id as intake_id,
  i.company_id,
  i.created_customer_id as customer_id,
  coalesce(c.customer_number, null) as customer_number,
  coalesce(nullif(trim(concat_ws(' ', i.first_name, i.last_name)), ''), nullif(i.company_name, ''), nullif(c.full_name, ''), nullif(c.company_name, ''), 'Namnlös kundansökan') as customer_name,
  coalesce(i.email, c.email) as customer_email,
  coalesce(i.phone, c.phone) as customer_phone,
  i.status,
  array_remove(array[
    case when nullif(coalesce(i.facility_id, ''), '') is null then 'facility_id' end,
    case when nullif(coalesce(i.meter_point_id, ''), '') is null and i.created_metering_point_id is null then 'metering_point_id' end,
    case when i.created_customer_id is null then 'customer' end,
    case when i.created_site_id is null then 'site' end,
    case when i.created_contract_id is null then 'contract' end,
    case when jsonb_typeof(i.issues) = 'array' and jsonb_array_length(i.issues) > 0 then 'review_issues' end
  ], null) as missing_fields,
  array_remove(array[
    case when i.status in ('needs_review','failed') then i.status end,
    case when nullif(coalesce(i.facility_id, ''), '') is null then 'missing_facility_id' end,
    case when nullif(coalesce(i.meter_point_id, ''), '') is null and i.created_metering_point_id is null then 'missing_metering_point_id' end,
    case when jsonb_typeof(i.issues) = 'array' and jsonb_array_length(i.issues) > 0 then 'intake_issues' end
  ], null) as blocking_reasons,
  coalesce(i.payload #>> '{energy_resolution,grid_owner_name}', i.payload #>> '{gridOwner,name}', i.payload #>> '{suggested_grid_owner_name}') as suggested_grid_owner_name,
  coalesce(i.payload #>> '{energy_resolution,grid_area_code}', i.payload #>> '{gridOwner,grid_area_code}', i.payload #>> '{suggested_grid_area_code}') as suggested_grid_area_code,
  i.price_area_code,
  case
    when coalesce(i.payload #>> '{energy_resolution,confidence}', i.payload #>> '{confidence}', '') ~ '^[0-9]+(\.[0-9]+)?$'
      then coalesce(i.payload #>> '{energy_resolution,confidence}', i.payload #>> '{confidence}')::numeric
    else null
  end as confidence,
  case
    when i.status = 'failed' then 'Granska fel och åtgärda ansökan'
    when i.status = 'needs_review' then 'Komplettera saknade uppgifter'
    when nullif(coalesce(i.facility_id, ''), '') is null then 'Begär eller fyll i anläggnings-id'
    when nullif(coalesce(i.meter_point_id, ''), '') is null and i.created_metering_point_id is null then 'Begär eller fyll i mätpunkt'
    when i.created_contract_id is null then 'Slutför avtal'
    else 'Granska och fortsätt'
  end as next_action,
  i.created_at,
  i.updated_at
from public.external_contract_intakes i
left join public.customers c on c.id = i.created_customer_id;

revoke all on public.company_customer_intake_queue_v from anon;
grant select on public.company_customer_intake_queue_v to authenticated;

create or replace view public.company_customer_list_summary_v
with (security_invoker = true)
as
select
  c.id as customer_id,
  c.company_id,
  c.customer_number,
  coalesce(nullif(c.full_name, ''), nullif(c.company_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Namnlös kund') as customer_name,
  c.email,
  c.phone,
  c.status,
  c.customer_type,
  (select count(*) from public.customer_sites s where s.company_id = c.company_id and s.customer_id = c.id) as sites_count,
  (select count(*) from public.metering_points mp where mp.company_id = c.company_id and mp.customer_id = c.id) as metering_points_count,
  latest_contract.status as active_contract_status,
  greatest(
    c.updated_at,
    coalesce(latest_contract.updated_at, c.updated_at),
    coalesce((select max(t.updated_at) from public.customer_operation_tasks t where t.company_id = c.company_id and t.customer_id = c.id), c.updated_at)
  ) as latest_activity_at,
  (select count(*) from public.customer_operation_tasks t where t.company_id = c.company_id and t.customer_id = c.id and t.status in ('open','in_progress','blocked')) as blocking_reason_count
from public.customers c
left join lateral (
  select cc.status, cc.updated_at
  from public.customer_contracts cc
  where cc.company_id = c.company_id and cc.customer_id = c.id
  order by cc.updated_at desc nulls last, cc.created_at desc
  limit 1
) latest_contract on true
where c.company_id is not null
  and coalesce(c.source, '') <> 'ediel_portal_test'
  and coalesce(c.status, '') not in ('archived','deleted','deleted_test_only','pending_deletion');

revoke all on public.company_customer_list_summary_v from anon;
grant select on public.company_customer_list_summary_v to authenticated;

create or replace view public.company_switch_queue_v
with (security_invoker = true)
as
select
  s.id as switch_id,
  s.company_id,
  s.customer_id,
  coalesce(c.customer_number, '') as customer_number,
  coalesce(nullif(c.full_name, ''), nullif(c.company_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Namnlös kund') as customer_name,
  s.site_id,
  s.metering_point_id,
  s.status,
  s.requested_start_date,
  s.completed_at as confirmed_start_date,
  case
    when s.lifecycle_blocked then coalesce(s.lifecycle_block_source, 'blocked')
    when s.status in ('failed','rejected') then coalesce(s.failure_reason, s.status)
    when s.power_of_attorney_id is null and s.authorization_document_id is null then 'missing_power_of_attorney'
    when s.metering_point_id is null then 'missing_metering_point'
    when s.site_id is null then 'missing_site'
    else null
  end as blocking_reason,
  case
    when s.lifecycle_blocked or s.status in ('failed','rejected') then 'Åtgärda blockerare'
    when s.status in ('draft','open') then 'Kontrollera och starta byte'
    when s.status in ('queued','submitted') then 'Följ upp utskick'
    when s.status in ('accepted','confirmed','completed') then 'Bekräftad'
    else 'Granska ärende'
  end as next_action,
  s.created_at,
  s.updated_at
from public.supplier_switch_requests s
left join public.customers c on c.id = s.customer_id;

revoke all on public.company_switch_queue_v from anon;
grant select on public.company_switch_queue_v to authenticated;

create or replace view public.company_billing_period_summary_v
with (security_invoker = true)
as
select
  b.company_id,
  concat(b.underlay_year::text, '-', lpad(b.underlay_month::text, 2, '0')) as period_key,
  b.underlay_year,
  b.underlay_month,
  count(*) as underlays_total,
  count(*) filter (where coalesce(b.readiness_status, b.status) in ('ready','validated','exported')) as underlays_ready,
  count(*) filter (where coalesce(b.readiness_status, b.status) in ('blocked','failed','needs_review')) as underlays_blocked,
  count(*) filter (where b.exported_at is not null or b.status = 'exported') as underlays_exported,
  max(b.updated_at) as latest_activity_at
from public.billing_underlays b
where b.company_id is not null
  and b.underlay_year is not null
  and b.underlay_month is not null
group by b.company_id, b.underlay_year, b.underlay_month;

revoke all on public.company_billing_period_summary_v from anon;
grant select on public.company_billing_period_summary_v to authenticated;
