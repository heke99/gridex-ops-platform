-- Gridex Automatic Customer Intake Foundation
-- Adds a business-level readiness view on top of the existing technical route
-- readiness so automation can distinguish "technically send-ready" from
-- "safe for ordinary electricity customer flows".

create or replace view public.gridex_grid_owner_business_readiness_v as
select
  gr.*,
  case
    when lower(coalesce(gr.grid_owner_name, '')) like '%dummy%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%test%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%systemleverantör%'
      then 'dummy'
    when lower(coalesce(gr.grid_owner_name, '')) like '%svenska kraftnät%'
      or coalesce(gr.grid_owner_ediel_id, '') = '10000'
      then 'system_actor'
    when lower(coalesce(gr.grid_owner_name, '')) like '%gas%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%swedegas%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%weum%'
      then 'gas'
    when lower(coalesce(gr.grid_owner_name, '')) like '%industri%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%billerud%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%ovako%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%bruk%'
      then 'industrial'
    when gr.grid_owner_id is not null then 'electricity_grid_owner'
    else 'unknown'
  end as actor_scope,
  coalesce(gr.send_ready, false) as technical_send_ready,
  case
    when lower(coalesce(gr.grid_owner_name, '')) like '%dummy%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%test%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%systemleverantör%'
      then false
    when lower(coalesce(gr.grid_owner_name, '')) like '%gas%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%swedegas%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%weum%'
      then false
    when lower(coalesce(gr.grid_owner_name, '')) like '%svenska kraftnät%'
      or coalesce(gr.grid_owner_ediel_id, '') = '10000'
      then false
    when coalesce(gr.send_ready, false) = true
      and gr.grid_owner_id is not null
      and gr.blocker_code is null
      then true
    else false
  end as business_production_approved,
  case
    when lower(coalesce(gr.grid_owner_name, '')) like '%dummy%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%test%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%systemleverantör%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%gas%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%swedegas%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%weum%'
      or lower(coalesce(gr.grid_owner_name, '')) like '%svenska kraftnät%'
      or coalesce(gr.grid_owner_ediel_id, '') = '10000'
      then true
    else false
  end as excluded_from_standard_customer_flows,
  case
    when gr.message_family = 'PRODAT' and gr.message_code = 'Z01' then 'facility_lookup'
    when gr.message_family = 'PRODAT' then 'prodat_customer_process'
    when gr.message_family = 'UTILTS' then 'metering_values'
    else 'unknown'
  end as process_scope
from public.gridex_company_route_readiness_v gr;

grant select on public.gridex_grid_owner_business_readiness_v to authenticated, service_role;

comment on view public.gridex_grid_owner_business_readiness_v is
  'Business-level grid owner readiness for automatic customer intake. technical_send_ready can be true while business_production_approved is false for dummy, gas, system or special actors.';
