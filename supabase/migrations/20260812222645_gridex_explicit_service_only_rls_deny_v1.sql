-- Make the existing implicit default-deny state explicit for service-only/internal tables.
-- This does not grant anon/authenticated access; it documents and preserves denial via RLS.
set lock_timeout = '5s';
set statement_timeout = '120s';

do $do$
declare
  v_table text;
  v_tables constant text[] := array[
    'automation_locks',
    'billing_adjustment_cases',
    'billing_automation_jobs',
    'company_number_sequences',
    'contract_lifecycle_backfill_issues',
    'contract_lifecycle_operation_errors',
    'customer_application_intakes',
    'customer_external_auth_links',
    'customer_portal_write_idempotency',
    'customer_site_address_conflicts',
    'customer_site_address_history',
    'document_parse_jobs',
    'ediel_ack_matrix_rules',
    'ediel_ack_transaction_results',
    'ediel_business_correlations',
    'ediel_business_expectations',
    'ediel_business_transactions',
    'ediel_business_transition_rules',
    'ediel_compliance_decision_events',
    'ediel_compliance_decisions',
    'ediel_compliance_evidence',
    'ediel_compliance_rules',
    'ediel_control_tower_events',
    'ediel_inbound_processing_records',
    'ediel_route_resolution_cache',
    'ediel_route_resolution_test_cases',
    'ediel_route_shadow_findings',
    'ediel_sla_deadlines',
    'ediel_sla_definitions',
    'energy_area_resolution_log',
    'energy_area_resolver_quality',
    'event_dispatch_leases',
    'external_contract_intakes',
    'external_contract_source_mappings',
    'grid_area_resolution_test_cases',
    'gridex_actor_certification_prerequisites',
    'gridex_api_deprecation_consumer_cutovers',
    'gridex_api_deprecation_consumer_inventory',
    'gridex_api_deprecation_gates',
    'gridex_api_deprecation_run_evidence',
    'gridex_api_endpoint_capability_matrix',
    'gridex_api_route_disposition',
    'gridex_asset_integrity_check_runs',
    'gridex_asset_integrity_quarantine',
    'gridex_asset_registry',
    'gridex_contract_state_transition_rules',
    'gridex_document_metadata',
    'gridex_ediel_certification_assertion_catalog',
    'gridex_ediel_execution_adapters',
    'gridex_lifecycle_code_definition',
    'gridex_lifecycle_readiness_requirement',
    'gridex_replay_checkpoints',
    'gridex_signing_contexts',
    'gridex_state_machine_runtime_rules',
    'identity_invariant_violations',
    'integration_api_idempotency',
    'integration_api_requests',
    'integration_health_events',
    'product_plan_versions',
    'site_ownership_conflicts',
    'webhook_dispatch_leases'
  ];
begin
  foreach v_table in array v_tables loop
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table
        and c.relkind in ('r','p')
        and c.relrowsecurity
    )
    and not exists (
      select 1
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table
    )
    and not exists (
      select 1
      from information_schema.role_table_grants g
      where g.table_schema = 'public'
        and g.table_name = v_table
        and g.grantee in ('anon','authenticated')
    ) then
      execute format(
        'create policy %I on public.%I as permissive for all to anon, authenticated using (false) with check (false)',
        'gridex_service_only_explicit_deny',
        v_table
      );
    end if;
  end loop;
end
$do$;
