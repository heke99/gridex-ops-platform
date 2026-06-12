-- OPS points 1-8 final hardening: RBAC/readiness observability, usage billing statistics,
-- actor import preview visibility, grid-owner verification status and support-case cleanup.
-- Additive/idempotent. Does not delete customer/audit history.

-- 1) Monthly usage/statistics read model for SaaS billing and tenant reporting.
create or replace view public.gridex_tenant_usage_monthly_v as
select
  company_id,
  date_trunc('month', occurred_at)::date as usage_month,
  event_key,
  billing_unit,
  is_billable,
  count(*)::bigint as event_count,
  coalesce(sum(billable_quantity), 0)::numeric as billable_quantity,
  min(occurred_at) as first_event_at,
  max(occurred_at) as last_event_at
from public.platform_usage_events
group by company_id, date_trunc('month', occurred_at)::date, event_key, billing_unit, is_billable;

comment on view public.gridex_tenant_usage_monthly_v is
  'Monthly tenant usage summary used for SaaS billing statistics. Source: platform_usage_events; audit_logs remains the legal trace.';

-- 2) Actor import preview/readiness model. Preview runs do not update masterdata until platform admin confirms IMPORTERA.
create or replace view public.gridex_actor_import_preview_v as
select
  r.id as import_run_id,
  r.source,
  r.import_type,
  r.status,
  coalesce(r.metadata->>'mode', 'apply') as import_mode,
  r.records_seen,
  r.records_upserted,
  r.records_failed,
  r.safe,
  case when (r.metadata #>> '{preview,newActors}') ~ '^[0-9]+$' then (r.metadata #>> '{preview,newActors}')::integer else null end as new_actors,
  case when (r.metadata #>> '{preview,existingActors}') ~ '^[0-9]+$' then (r.metadata #>> '{preview,existingActors}')::integer else null end as existing_actors,
  case when (r.metadata #>> '{preview,changedActors}') ~ '^[0-9]+$' then (r.metadata #>> '{preview,changedActors}')::integer else null end as changed_actors,
  case when (r.metadata #>> '{preview,gridOwners}') ~ '^[0-9]+$' then (r.metadata #>> '{preview,gridOwners}')::integer else null end as grid_owners,
  case when (r.metadata #>> '{preview,electricitySuppliers}') ~ '^[0-9]+$' then (r.metadata #>> '{preview,electricitySuppliers}')::integer else null end as electricity_suppliers,
  case when (r.metadata #>> '{preview,routesSeen}') ~ '^[0-9]+$' then (r.metadata #>> '{preview,routesSeen}')::integer else null end as routes_seen,
  case when (r.metadata #>> '{preview,prodatRoutes}') ~ '^[0-9]+$' then (r.metadata #>> '{preview,prodatRoutes}')::integer else null end as prodat_routes,
  case when (r.metadata #>> '{preview,utiltsRoutes}') ~ '^[0-9]+$' then (r.metadata #>> '{preview,utiltsRoutes}')::integer else null end as utilts_routes,
  case when (r.metadata #>> '{preview,missingEdielId}') ~ '^[0-9]+$' then (r.metadata #>> '{preview,missingEdielId}')::integer else null end as missing_ediel_id,
  case when (r.metadata #>> '{preview,missingRoutes}') ~ '^[0-9]+$' then (r.metadata #>> '{preview,missingRoutes}')::integer else null end as missing_routes,
  case when (r.metadata #>> '{preview,conflicts}') ~ '^[0-9]+$' then (r.metadata #>> '{preview,conflicts}')::integer else null end as conflicts,
  r.started_at,
  r.completed_at,
  r.created_by,
  r.metadata,
  r.error_log
from public.platform_actor_import_runs r;

comment on view public.gridex_actor_import_preview_v is
  'Platform-admin import preview status for Ediel actors, routes, contact paths and grid owners before masterdata is changed.';

-- 3) Grid-owner verification status used by intake and actor registry filters.
create or replace view public.gridex_grid_owner_verification_status_v as
with actor_base as (
  select
    a.id as actor_id,
    a.name,
    a.org_number,
    a.status,
    a.match_status,
    a.visible_to_tenants,
    a.updated_at,
    max(i.identifier_value) filter (where i.identifier_type = 'EdielId') as ediel_id,
    bool_or(r.actor_role in ('grid_owner','netowner','network_owner')) as has_grid_owner_role
  from public.platform_market_actors a
  left join public.platform_actor_roles r on r.actor_id = a.id and coalesce(r.is_active, true)
  left join public.platform_actor_identifiers i on i.actor_id = a.id
  group by a.id, a.name, a.org_number, a.status, a.match_status, a.visible_to_tenants, a.updated_at
), route_base as (
  select
    actor_id,
    bool_or(upper(message_family) = 'PRODAT') as has_prodat_route,
    bool_or(upper(message_family) = 'UTILTS') as has_utilts_route,
    bool_or(coalesce(communication_address, '') <> '') as has_contact_path,
    bool_or(coalesce(is_verified, false) or status in ('active','verified')) as has_verified_route,
    bool_or(coalesce(auto_send_allowed, false)) as has_auto_send_route,
    count(*)::integer as route_count
  from public.platform_actor_routes
  group by actor_id
)
select
  a.actor_id,
  a.name,
  a.org_number,
  a.ediel_id,
  a.status,
  a.match_status,
  a.visible_to_tenants,
  coalesce(a.has_grid_owner_role, false) as has_grid_owner_role,
  coalesce(r.has_prodat_route, false) as has_prodat_route,
  coalesce(r.has_utilts_route, false) as has_utilts_route,
  coalesce(r.has_contact_path, false) as has_contact_path,
  coalesce(r.has_verified_route, false) as has_verified_route,
  coalesce(r.has_auto_send_route, false) as has_auto_send_route,
  coalesce(r.route_count, 0) as route_count,
  case
    when not coalesce(a.has_grid_owner_role, false) then 'inte_nätägare'
    when a.ediel_id is null or btrim(a.ediel_id) = '' then 'saknar_ediel_id'
    when not coalesce(r.has_prodat_route, false) and not coalesce(r.has_utilts_route, false) then 'saknar_route'
    when not coalesce(r.has_contact_path, false) then 'saknar_kontaktväg'
    when a.match_status = 'verified' and coalesce(r.has_verified_route, false) then 'verifierad'
    when a.match_status = 'verified' then 'delvis_verifierad'
    else 'kräver_manuell_kontroll'
  end as verification_status,
  case
    when a.ediel_id is null or btrim(a.ediel_id) = '' then 'Komplettera Ediel-ID innan aktören kan användas i kundintag.'
    when not coalesce(r.has_prodat_route, false) and not coalesce(r.has_utilts_route, false) then 'Lägg till PRODAT/UTILTS-route eller fallback innan automatiska förfrågningar.'
    when not coalesce(r.has_contact_path, false) then 'Komplettera SMTP/kontaktväg för fallback och manuell hantering.'
    when a.match_status <> 'verified' then 'Verifiera aktören i plattformsregistret.'
    else 'Ingen manuell åtgärd krävs.'
  end as next_action,
  a.updated_at
from actor_base a
left join route_base r on r.actor_id = a.actor_id
where coalesce(a.has_grid_owner_role, false);

comment on view public.gridex_grid_owner_verification_status_v is
  'Grid-owner readiness summary for intake, actor registry and platform backfill. Address/postal code can suggest; Ediel/nätområdeskod/facility data verify.';

-- 4) Neutralise support/case email rules and templates inside OPS. Historical rows stay for audit if already sent.
do $$
begin
  if to_regclass('public.email_event_rules') is not null then
    update public.email_event_rules
       set enabled = false,
           updated_at = now()
     where event_key in ('support.case_message','case.created','case.updated')
        or event_key like 'customer.support%'
        or event_key like 'customer.case%';
  end if;

  if to_regclass('public.company_email_templates') is not null then
    update public.company_email_templates
       set is_active = false,
           updated_at = now()
     where template_key in ('support.case_message','case.created','case.updated')
        or template_key like 'customer.support%'
        or template_key like 'customer.case%';
  end if;
end $$;

-- 5) Small indexes supporting the new views and work queues.
create index if not exists platform_usage_events_company_period_key_idx
  on public.platform_usage_events(company_id, occurred_at desc, event_key);
create index if not exists platform_actor_import_runs_mode_idx
  on public.platform_actor_import_runs ((metadata->>'mode'), started_at desc);
create index if not exists platform_actor_routes_actor_family_status_idx
  on public.platform_actor_routes(actor_id, message_family, status);
