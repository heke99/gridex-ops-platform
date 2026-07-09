-- Supabase advisor hardening B: EXECUTE revokes on SECURITY DEFINER functions.
--
-- Advisors: anon_security_definer_function_executable,
--           authenticated_security_definer_function_executable (WARN).
--
-- Every privileged SECURITY DEFINER function below is called exclusively via
-- the backend service role in this repository (verified: no user-context
-- `.rpc(...)` call sites). EXECUTE is therefore revoked from PUBLIC, anon and
-- authenticated, and explicitly granted to service_role so all worker/cron/
-- API flows keep working unchanged. Direct PostgREST RPC from anon or plain
-- signed-in users is no longer possible for these.
--
-- DOCUMENTED EXCEPTIONS (kept executable by authenticated, revoked from anon):
--   - public.gridex_user_is_platform_admin()
--   - public.gridex_can_read_company(uuid)
--   - public.gridex_can_write_company(uuid)
--   - public.gridex_user_company_ids()
--   - public.gridex_current_user_context()
--   These are RLS/RBAC helper functions referenced by hundreds of row level
--   security policies; policy evaluation runs with the querying role's
--   privileges, so authenticated MUST keep EXECUTE. They only return booleans
--   or the caller's own membership context (auth.uid()-scoped), expose no
--   table data and mutate nothing.
--
-- Guarded with to_regprocedure so the migration replays safely where an
-- object does not exist.
--
-- See docs/security/supabase-advisors-hardening.md for the full inventory.

set lock_timeout = '5s';
set statement_timeout = '120s';

do $$
declare
  fn text;
begin
  -- Privileged functions: service-role only.
  foreach fn in array array[
    'public.anonymize_user_account(uuid)',
    'public.check_email_exists(text)',
    'public.complete_core_onboarding(uuid)',
    'public.select_onboarding_start_path(uuid, text)',
    'public.gridex_actor_readiness_backfill(text)',
    'public.gridex_apply_actor_auto_send_readiness(uuid)',
    'public.gridex_approve_first_production_send(uuid, uuid, uuid, text)',
    'public.gridex_backfill_grid_owner_verification(text)',
    'public.gridex_complete_grid_owner_readiness(text)',
    'public.gridex_confirm_grid_owner_empty_subaddress(uuid, text, uuid, text)',
    'public.gridex_confirm_registry_empty_subaddresses(text)',
    'public.gridex_confirm_safe_blank_route_subaddresses(text, uuid, boolean)',
    'public.gridex_create_actor_registry_conflict(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb)',
    'public.gridex_customer_cleanup_external_ref(uuid)',
    'public.gridex_default_document_prefix(uuid, text)',
    'public.gridex_invalidate_site_operations_on_address_change()',
    'public.gridex_match_actor_registry_item(uuid)',
    'public.gridex_materialize_company_operational_routes(uuid, text, text, uuid, uuid, text, boolean)',
    'public.gridex_next_application_number(uuid)',
    'public.gridex_next_contract_number(uuid, text)',
    'public.gridex_next_document_number(uuid, text, text)',
    'public.gridex_optimize_rls_auth_initplans()',
    'public.gridex_recalculate_actor_readiness(uuid)',
    'public.gridex_refresh_actor_certificate_statuses(text)',
    'public.gridex_resolve_ediel_route_for_process(uuid, text, text, text, text)',
    'public.gridex_seed_default_legal_package_after_company_insert()',
    'public.gridex_seed_default_legal_package_for_company(uuid, uuid)',
    'public.gridex_unlock_pricing_runs_for_month(uuid, text, uuid, text)',
    'public.gridex_upsert_customer_action_task(uuid, uuid, text, text, text, text, jsonb)'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public', fn);
      execute format('revoke execute on function %s from anon', fn);
      execute format('revoke execute on function %s from authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    else
      raise notice 'gridex advisor hardening: function % not found, skipping execute revoke', fn;
    end if;
  end loop;

  -- RLS/RBAC helper exceptions: keep authenticated (required by policies),
  -- revoke anon + PUBLIC, keep service_role.
  foreach fn in array array[
    'public.gridex_user_is_platform_admin()',
    'public.gridex_can_read_company(uuid)',
    'public.gridex_can_write_company(uuid)',
    'public.gridex_user_company_ids()',
    'public.gridex_current_user_context()'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public', fn);
      execute format('revoke execute on function %s from anon', fn);
      execute format('grant execute on function %s to authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    else
      raise notice 'gridex advisor hardening: function % not found, skipping rls-helper grant fix', fn;
    end if;
  end loop;
end $$;
