-- Platform dashboard + authenticated SELECT RLS performance hardening.
--
-- Goals:
--   1. Replace the platform-admin /admin count storm with one service-role-only RPC.
--   2. Preserve tenant isolation while avoiding repeated RBAC/membership function work per row.
--   3. Leave INSERT/UPDATE/DELETE policies untouched.

create or replace function public.gridex_platform_dashboard_summary_v1()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $function$
with
customer_stats as (
  select count(*) filter (
    where company_id is not null
      and (source is null or source <> 'ediel_portal_test')
      and (status is null or status not in ('archived','deleted','deleted_test_only','pending_deletion'))
  )::bigint as customers_total
  from public.customers
),
contract_stats as (
  select
    count(*)::bigint as contracts_total,
    count(*) filter (
      where ends_at >= current_date
        and ends_at <= current_date + interval '30 days'
    )::bigint as upcoming_terminations
  from public.customer_contracts
),
site_stats as (
  select count(*)::bigint as sites_total
  from public.customer_sites
),
metering_point_stats as (
  select count(*)::bigint as metering_points_total
  from public.metering_points
),
task_stats as (
  select
    count(*) filter (where status = 'open')::bigint as open_tasks,
    count(*) filter (where status in ('open','in_progress','blocked'))::bigint as customers_action_required
  from public.customer_operation_tasks
),
grid_owner_request_stats as (
  select
    count(*) filter (where status = 'sent')::bigint as open_grid_owner_requests,
    count(*) filter (where status in ('sent','waiting_response','queued'))::bigint as waiting_for_grid_owner
  from public.grid_owner_data_requests
),
switch_stats as (
  select
    count(*) filter (where status = 'open')::bigint as open_switches,
    count(*) filter (
      where status in (
        'draft','queued','submitted','accepted','cancellation_requested',
        'cancellation_sent','manual_followup_required'
      )
    )::bigint as ongoing_supplier_switches
  from public.supplier_switch_requests
),
outbound_stats as (
  select count(*)::bigint as outbound_requests_total
  from public.outbound_requests
),
metering_value_stats as (
  select
    count(*)::bigint as metering_values_total,
    count(*) filter (where created_at >= now() - interval '7 days')::bigint as latest_metering_values
  from public.metering_values
),
billing_stats as (
  select count(*)::bigint as billing_underlays_total
  from public.billing_underlays
),
data_quality_stats as (
  select count(*) filter (
    where status = 'open' and issue_type = 'missing_metering_values'
  )::bigint as missing_metering_values
  from public.data_quality_issues
),
intake_stats as (
  select count(*) filter (
    where status in ('needs_review','partially_created','failed')
  )::bigint as pending_customer_applications
  from public.external_contract_intakes
),
ediel_message_stats as (
  select
    count(*)::bigint as total_messages,
    count(*) filter (where direction = 'inbound')::bigint as inbound_messages,
    count(*) filter (where direction = 'outbound')::bigint as outbound_messages,
    count(*) filter (where status = 'draft')::bigint as draft_messages,
    count(*) filter (where status = 'failed')::bigint as failed_messages,
    count(*) filter (where status = 'queued')::bigint as queued_messages,
    count(*) filter (where status = 'prepared')::bigint as prepared_messages,
    count(*) filter (where status = 'sent')::bigint as sent_messages,
    count(*) filter (
      where contrl_status = 'pending' or aperak_status = 'pending'
    )::bigint as ack_pending_messages,
    count(*) filter (
      where (contrl_status = 'pending' or aperak_status = 'pending')
        and ack_due_at < now()
    )::bigint as ack_overdue_messages,
    count(*) filter (where ack_outcome = 'negative')::bigint as negative_acknowledgements
  from public.ediel_messages
),
route_stats as (
  select count(*) filter (
    where is_active = true
      and (
        route_type = 'ediel_partner'
        or target_system ilike '%ediel%'
        or target_email ilike '%ediel%'
      )
  )::bigint as active_routes
  from public.communication_routes
),
profile_stats as (
  select count(*)::bigint as configured_profiles
  from public.ediel_route_profiles
),
test_stats as (
  select count(*) filter (where status in ('draft','running'))::bigint as active_test_runs
  from public.ediel_test_runs
),
platform_stats as (
  select
    (select count(*)::bigint from public.companies) as companies_total,
    (select count(*)::bigint from public.grid_owners) as grid_owners_total,
    (select count(*)::bigint from public.electricity_suppliers) as electricity_suppliers_total
)
select jsonb_build_object(
  'generated_at', now(),
  'customers_total', cs.customers_total,
  'contracts_total', cts.contracts_total,
  'sites_total', ss.sites_total,
  'metering_points_total', mps.metering_points_total,
  'open_tasks', ts.open_tasks,
  'open_grid_owner_requests', gos.open_grid_owner_requests,
  'open_switches', sws.open_switches,
  'outbound_requests_total', os.outbound_requests_total,
  'metering_values_total', mvs.metering_values_total,
  'billing_underlays_total', bs.billing_underlays_total,
  'ongoing_supplier_switches', sws.ongoing_supplier_switches,
  'waiting_for_grid_owner', gos.waiting_for_grid_owner,
  'negative_acknowledgements', ems.negative_acknowledgements,
  'missing_metering_values', dqs.missing_metering_values,
  'customers_action_required', ts.customers_action_required,
  'latest_metering_values', mvs.latest_metering_values,
  'upcoming_terminations', cts.upcoming_terminations,
  'pending_customer_applications', ins.pending_customer_applications,
  'companies_total', ps.companies_total,
  'grid_owners_total', ps.grid_owners_total,
  'electricity_suppliers_total', ps.electricity_suppliers_total,
  'ediel', jsonb_build_object(
    'total_messages', ems.total_messages,
    'inbound_messages', ems.inbound_messages,
    'outbound_messages', ems.outbound_messages,
    'draft_messages', ems.draft_messages,
    'failed_messages', ems.failed_messages,
    'queued_messages', ems.queued_messages,
    'prepared_messages', ems.prepared_messages,
    'sent_messages', ems.sent_messages,
    'ack_pending_messages', ems.ack_pending_messages,
    'ack_overdue_messages', ems.ack_overdue_messages,
    'active_routes', rs.active_routes,
    'configured_profiles', prs.configured_profiles,
    'active_test_runs', tes.active_test_runs,
    'running_tests', tes.active_test_runs
  )
)
from customer_stats cs
cross join contract_stats cts
cross join site_stats ss
cross join metering_point_stats mps
cross join task_stats ts
cross join grid_owner_request_stats gos
cross join switch_stats sws
cross join outbound_stats os
cross join metering_value_stats mvs
cross join billing_stats bs
cross join data_quality_stats dqs
cross join intake_stats ins
cross join ediel_message_stats ems
cross join route_stats rs
cross join profile_stats prs
cross join test_stats tes
cross join platform_stats ps;
$function$;

-- The aggregate is intentionally unavailable to browser/authenticated clients.
-- The server checks platform-admin access before it reaches the service-role loader.
revoke all on function public.gridex_platform_dashboard_summary_v1() from public, anon, authenticated;
grant execute on function public.gridex_platform_dashboard_summary_v1() to service_role;

-- First collapse the dashboard-heavy authenticated SELECT policies. Every table
-- in this list already has a restrictive lifecycle guard, so the old permissive
-- expression cannot broaden the effective result beyond that restrictive guard.
do $do$
declare
  target_table text;
  legacy_policy record;
  target_tables text[] := array[
    'customers','customer_contracts','customer_sites','metering_points',
    'customer_operation_tasks','grid_owner_data_requests','supplier_switch_requests',
    'outbound_requests','metering_values','billing_underlays','ediel_messages',
    'external_contract_intakes','communication_routes','ediel_route_profiles',
    'grid_owners','companies'
  ];
begin
  foreach target_table in array target_tables loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = target_table
        and cmd = 'SELECT'
        and permissive = 'RESTRICTIVE'
        and roles = array['authenticated']::name[]
    ) then
      continue;
    end if;

    if exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = target_table
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
        and roles = array['authenticated']::name[]
        and policyname like 'gridex_mp_%'
    ) then
      execute format('drop policy if exists gridex_perf_authenticated_select_v1 on public.%I', target_table);
      execute format(
        'create policy gridex_perf_authenticated_select_v1 on public.%I as permissive for select to authenticated using (true)',
        target_table
      );

      for legacy_policy in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = target_table
          and cmd = 'SELECT'
          and permissive = 'PERMISSIVE'
          and roles = array['authenticated']::name[]
          and policyname like 'gridex_mp_%'
      loop
        execute format('drop policy %I on public.%I', legacy_policy.policyname, target_table);
      end loop;
    end if;
  end loop;
end
$do$;

-- Convert the standard row-dependent can_read_company() guard into statement-level
-- initplans. The expression is equivalent to gridex_can_read_company(company_id):
-- session allowed AND (platform admin OR active company membership).
do $do$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and cmd = 'SELECT'
      and permissive = 'RESTRICTIVE'
      and roles = array['authenticated']::name[]
      and policyname = 'tenant_lifecycle_select_guard'
      and qual = 'gridex_can_read_company(company_id)'
  loop
    execute format(
      'alter policy %I on public.%I using ((select public.gridex_is_current_session_allowed()) and ((select public.gridex_user_is_platform_admin()) or company_id in (select public.gridex_user_company_ids())))',
      policy_row.policyname,
      policy_row.tablename
    );
  end loop;
end
$do$;

-- For remaining tables that have the same restrictive tenant guard plus a legacy
-- authenticated permissive branch containing can_read_company(company_id), the
-- effective old predicate was R AND (R OR extra) = R. Replace only that duplicated
-- permissive branch with TRUE. Write policies and permission-specific policies are
-- not changed.
do $do$
declare
  table_row record;
  legacy_policy record;
begin
  for table_row in
    select distinct p.tablename
    from pg_policies p
    where p.schemaname = 'public'
      and p.cmd = 'SELECT'
      and p.permissive = 'PERMISSIVE'
      and p.roles = array['authenticated']::name[]
      and p.policyname like 'gridex_mp_%'
      and coalesce(p.qual, '') ilike '%gridex_can_read_company(company_id)%'
      and exists (
        select 1
        from pg_policies r
        where r.schemaname = 'public'
          and r.tablename = p.tablename
          and r.cmd = 'SELECT'
          and r.permissive = 'RESTRICTIVE'
          and r.roles = array['authenticated']::name[]
          and r.policyname = 'tenant_lifecycle_select_guard'
      )
  loop
    execute format('drop policy if exists gridex_perf_authenticated_select_v1 on public.%I', table_row.tablename);
    execute format(
      'create policy gridex_perf_authenticated_select_v1 on public.%I as permissive for select to authenticated using (true)',
      table_row.tablename
    );

    for legacy_policy in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_row.tablename
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
        and roles = array['authenticated']::name[]
        and policyname like 'gridex_mp_%'
        and coalesce(qual, '') ilike '%gridex_can_read_company(company_id)%'
    loop
      execute format('drop policy %I on public.%I', legacy_policy.policyname, table_row.tablename);
    end loop;
  end loop;
end
$do$;

-- Companies uses id rather than company_id. Keep the same lifecycle semantics but
-- force user/session helpers into initplans.
do $do$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'companies'
      and policyname = 'companies_lifecycle_select_guard'
      and cmd = 'SELECT'
  ) then
    alter policy companies_lifecycle_select_guard on public.companies
    using (
      (select public.gridex_is_current_session_allowed())
      and (
        (select public.gridex_user_is_platform_admin())
        or id in (select public.gridex_user_company_ids())
      )
    );
  end if;
end
$do$;

-- electricity_suppliers deliberately keeps its masterdata permission gate. Only
-- cache those permission checks once per statement; do not replace them with TRUE.
do $do$
declare
  permission_policy record;
begin
  for permission_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'electricity_suppliers'
      and cmd = 'SELECT'
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and coalesce(qual, '') ilike '%gridex_has_permission%masterdata.read%'
      and coalesce(qual, '') ilike '%gridex_has_permission%masterdata.write%'
  loop
    execute format(
      'alter policy %I on public.electricity_suppliers using ((select public.gridex_has_permission((select auth.uid()), ''masterdata.read'')) or (select public.gridex_has_permission((select auth.uid()), ''masterdata.write'')))',
      permission_policy.policyname
    );
  end loop;
end
$do$;
