-- Supabase advisor hardening C: SECURITY DEFINER views -> security_invoker.
--
-- Advisor: security_definer_view (ERROR).
--
-- All 24 flagged views are readiness/diagnostic views consumed EXCLUSIVELY by
-- the backend service role in this repository (verified: every `.from('<view>')`
-- call site uses the service-role client; the anon-key browser client is never
-- imported). The safe remediation is therefore:
--   1. alter view ... set (security_invoker = true)  -- no recreation, columns/
--      comments/dependencies/owner preserved (Postgres 15+; live DB is PG 17),
--   2. revoke select from anon/authenticated -- these are service-only views
--      and must not be readable through PostgREST with either API role.
-- Service role keeps SELECT and bypasses RLS, so behavior for all app
-- consumers is unchanged.
--
-- Guarded with to_regclass so environments missing a view replay safely
-- (platform_grid_owner_readiness_v exists only on the live database).
--
-- See docs/security/supabase-advisors-hardening.md for the classification.

set lock_timeout = '5s';
set statement_timeout = '120s';

do $$
declare
  v text;
begin
  foreach v in array array[
    'public.company_actor_testing_status_v',
    'public.tenant_customer_intake_tracking_v',
    'public.tenant_event_mail_readiness_v',
    'public.gridex_ops_hardening_health_v',
    'public.tenant_contract_offer_readiness_v',
    'public.gridex_public_contract_offer_api_diagnostics_v',
    'public.gridex_multiple_permissive_policy_candidates_v',
    'public.gridex_duplicate_index_candidates_v',
    'public.gridex_data_cleanup_customer_candidates_v',
    'public.gridex_tenant_usage_monthly_v',
    'public.gridex_actor_import_preview_v',
    'public.gridex_grid_owner_verification_status_v',
    'public.gridex_public_contract_offer_admin_v',
    'public.gridex_api_client_permission_summary_v',
    'public.gridex_tenant_email_dispatch_readiness_v',
    'public.gridex_company_route_readiness_v',
    'public.customer_ops_master_readiness_v',
    'public.customer_ops_timeline_v',
    'public.tenant_website_readiness_v',
    'public.gridex_energy_geodata_health_v',
    'public.platform_grid_owner_readiness_v',
    'public.gridex_operational_route_repair_v',
    'public.gridex_grid_owner_business_readiness_v',
    'public.platform_go_live_readiness_v'
  ]
  loop
    if to_regclass(v) is not null then
      execute format('alter view %s set (security_invoker = true)', v);
      execute format('revoke all on %s from public', v);
      execute format('revoke all on %s from anon', v);
      execute format('revoke all on %s from authenticated', v);
      execute format('grant select on %s to service_role', v);
    else
      raise notice 'gridex advisor hardening: view % not found, skipping security_invoker conversion', v;
    end if;
  end loop;
end $$;
