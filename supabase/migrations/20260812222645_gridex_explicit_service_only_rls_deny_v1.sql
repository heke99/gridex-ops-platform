set lock_timeout = '5s';
set statement_timeout = '120s';

do $do$
declare
  v_table text;
  v_tables constant text[] := array[
    'automation_locks','billing_adjustment_cases','billing_automation_jobs','company_number_sequences',
    'contract_lifecycle_backfill_issues','contract_lifecycle_operation_errors','customer_application_intakes',
    'customer_external_auth_links','customer_portal_write_idempotency','customer_site_address_conflicts',
    'customer_site_address_history','document_parse_jobs','ediel_ack_matrix_rules','ediel_ack_transaction_results',
    'ediel_business_correlations','ediel_business_expectations','ediel_certification_evidence','ediel_inbound_quarantine',
    'ediel_production_send_approvals','ediel_repair_issues','ediel_repair_runs','ediel_rule_pack_backfill_issues',
    'ediel_rule_pack_snapshots','gridex_performance_hardening_events','integration_api_client_profiles',
    'integration_api_permission_groups','integration_api_rate_limit_buckets','integration_api_write_idempotency',
    'legal_bundle_items','legal_bundles','market_process_policies','onboarding_choices','onboarding_sessions',
    'onboarding_steps','ops_publication_state','platform_go_live_route_simulations','platform_outbound_state',
    'platform_performance_budgets','platform_reconciliation_findings','platform_release_receipts','platform_schema_state',
    'platform_usage_event_failures','platform_usage_events','portfolio_settlement_invoice_bindings','price_book_lines',
    'price_books','tenant_actor_identifiers','tenant_actor_roles','tenant_application_reference_profiles',
    'tenant_bilateral_agreements','tenant_certificate_profiles','tenant_communication_profiles',
    'tenant_counterparty_relations','tenant_counterparty_routes','tenant_ediel_profiles','tenant_email_outbox_runs',
    'tenant_launch_states','tenant_mailboxes','tenant_message_capabilities','tenant_website_installation_receipts',
    'website_public_contract_snapshots'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;

    -- These tables are deliberately service-role only. Keep the existing
    -- deny-by-default semantics explicit for PostgREST API roles without
    -- granting any table privileges or widening access.
    if not exists (
      select 1
      from pg_policy p
      where p.polrelid = to_regclass(format('public.%I', v_table))
        and p.polname = 'gridex_explicit_service_only_deny'
    ) then
      execute format(
        'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
        'gridex_explicit_service_only_deny', v_table
      );
    end if;
  end loop;
end
$do$;
