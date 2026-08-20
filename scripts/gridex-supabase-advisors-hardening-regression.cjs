#!/usr/bin/env node
// Regression: Supabase security advisors hardening batch.
//
// Static checks against the repo migrations + docs:
//  1. Migration A pins search_path on every advisor-flagged public function.
//  2. Migration B revokes anon/authenticated/PUBLIC execute on privileged
//     SECURITY DEFINER functions, keeps documented RLS-helper exceptions.
//  3. Migration C converts every flagged SECURITY DEFINER view to
//     security_invoker and revokes anon/authenticated select.
//  4. Migration D keeps service-only tables policy-free (deny-by-default),
//     revokes API-role grants, adds exactly one narrow tenant read policy on
//     customer_operation_jobs (no `using (true)` anywhere in the batch).
//  5. Leaked password protection is a documented manual production step.
//  6. New migrations (>= 20260709) that CREATE public functions must pin
//     search_path.
//
// Live verification SQL (K1-K4) lives in
// docs/security/supabase-advisors-hardening.md.
const fs = require('fs')
const path = require('path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
let failures = 0

function expect(condition, message) {
  if (!condition) {
    failures += 1
    console.error(`FAIL: ${message}`)
  } else {
    console.log(`OK: ${message}`)
  }
}

const migrationA = read('supabase/migrations/20260709160000_advisor_function_search_path.sql')
const migrationB = read('supabase/migrations/20260709161000_advisor_function_execute_revokes.sql')
const migrationC = read('supabase/migrations/20260709162000_advisor_security_invoker_views.sql')
const migrationD = read('supabase/migrations/20260709163000_advisor_rls_no_policy_hardening.sql')
const accountClosureMigration = read('supabase/migrations/20260811080000_remaining_masterpoint_convergence.sql')
const report = read('docs/security/supabase-advisors-hardening.md')
const envChecklist = read('docs/env-production-checklist.md')
const batch = [migrationA, migrationB, migrationC, migrationD].join('\n')

// 1. search_path coverage -------------------------------------------------------
const searchPathFunctions = [
  'gridex_normalize_customer_number_prefix(text, text)',
  'gridex_legal_text_versions_set_updated_at()',
  'gridex_prevent_published_legal_text_mutation()',
  'gridex_customer_legal_acceptances_immutable()',
  'gridex_assert_same_company(uuid, uuid, text, text)',
  'gridex_customer_sites_company_guard()',
  'gridex_metering_points_company_guard()',
  'gridex_customer_contracts_company_guard()',
  'gridex_contract_price_snapshots_company_guard()',
  'gridex_customer_legal_acceptances_company_guard()',
  'gridex_powers_of_attorney_company_guard()',
  'gridex_billing_underlays_company_guard()',
  'claim_inbound_processing_jobs(text, integer, text, interval)',
  'claim_ediel_outbox_items(text, uuid, integer, text, interval)',
  'gridex_normalize_actor_text(text)',
  'gridex_normalize_actor_identifier(text, text)',
  'gridex_normalize_public_offer_code(text)',
  'gridex_assign_public_offer_code()',
  'gridex_lonlat_to_grid_area(numeric, numeric)',
  'gridex_customer_operation_jobs_run_after_guard()',
  'gridex_platform_default_legal_templates_set_updated_at()',
  'gridex_block_contract_price_snapshot_mutation()',
  'gridex_protect_locked_pricing_runs()',
  'gridex_protect_sent_invoice_export_items()',
  'gridex_validate_outbound_payload()',
]
const missingSearchPath = searchPathFunctions.filter((fn) => !migrationA.includes(`public.${fn}`))
expect(
  missingSearchPath.length === 0,
  `migration A pins search_path on all ${searchPathFunctions.length} flagged functions${missingSearchPath.length ? ` (missing: ${missingSearchPath.join(', ')})` : ''}`
)
expect(
  migrationA.includes("'public, extensions, pg_temp'") &&
    /gridex_lonlat_to_grid_area\(numeric, numeric\)',\s*'public, extensions, pg_temp'/.test(migrationA),
  'PostGIS function gets extensions in search_path; everything else public, pg_temp'
)
expect(
  /alter function %s set search_path/.test(migrationA) && !/create or replace function/i.test(migrationA),
  'migration A uses ALTER FUNCTION only (no body/owner/mode changes)'
)

// 2. execute revokes ---------------------------------------------------------------
const privilegedFunctions = [
  'anonymize_user_account(uuid)',
  'check_email_exists(text)',
  'complete_core_onboarding(uuid)',
  'select_onboarding_start_path(uuid, text)',
  'gridex_actor_readiness_backfill(text)',
  'gridex_apply_actor_auto_send_readiness(uuid)',
  'gridex_approve_first_production_send(uuid, uuid, uuid, text)',
  'gridex_backfill_grid_owner_verification(text)',
  'gridex_complete_grid_owner_readiness(text)',
  'gridex_confirm_grid_owner_empty_subaddress(uuid, text, uuid, text)',
  'gridex_confirm_registry_empty_subaddresses(text)',
  'gridex_confirm_safe_blank_route_subaddresses(text, uuid, boolean)',
  'gridex_create_actor_registry_conflict(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, jsonb, jsonb)',
  'gridex_customer_cleanup_external_ref(uuid)',
  'gridex_default_document_prefix(uuid, text)',
  'gridex_invalidate_site_operations_on_address_change()',
  'gridex_match_actor_registry_item(uuid)',
  'gridex_materialize_company_operational_routes(uuid, text, text, uuid, uuid, text, boolean)',
  'gridex_next_application_number(uuid)',
  'gridex_next_contract_number(uuid, text)',
  'gridex_next_document_number(uuid, text, text)',
  'gridex_optimize_rls_auth_initplans()',
  'gridex_recalculate_actor_readiness(uuid)',
  'gridex_refresh_actor_certificate_statuses(text)',
  'gridex_resolve_ediel_route_for_process(uuid, text, text, text, text)',
  'gridex_seed_default_legal_package_after_company_insert()',
  'gridex_seed_default_legal_package_for_company(uuid, uuid)',
  'gridex_unlock_pricing_runs_for_month(uuid, text, uuid, text)',
  'gridex_upsert_customer_action_task(uuid, uuid, text, text, text, text, jsonb)',
]
const missingRevokes = privilegedFunctions.filter((fn) => !migrationB.includes(`public.${fn}`))
expect(
  missingRevokes.length === 0,
  `migration B covers all ${privilegedFunctions.length} privileged definer functions${missingRevokes.length ? ` (missing: ${missingRevokes.join(', ')})` : ''}`
)
expect(
  /revoke execute on function %s from public/.test(migrationB) &&
    /revoke execute on function %s from anon/.test(migrationB) &&
    /revoke execute on function %s from authenticated/.test(migrationB) &&
    /grant execute on function %s to service_role/.test(migrationB),
  'privileged functions: revoke PUBLIC/anon/authenticated, explicit service_role grant'
)
const rlsHelpers = [
  'gridex_user_is_platform_admin()',
  'gridex_can_read_company(uuid)',
  'gridex_can_write_company(uuid)',
  'gridex_user_company_ids()',
  'gridex_current_user_context()',
]
expect(
  rlsHelpers.every((fn) => migrationB.includes(`public.${fn}`)) &&
    /grant execute on function %s to authenticated/.test(migrationB),
  'RLS helper exceptions keep authenticated execute (revoked for anon), documented in-migration'
)
expect(
  rlsHelpers.every((fn) => report.includes(fn.replace('()', '()'))) &&
    /accepted with this/.test(report),
  'report documents the RLS-helper exceptions as accepted findings'
)
expect(
  /auth\.uid\(\) is distinct from target_user_id/.test(accountClosureMigration) &&
    /membership_role[\s\S]*?owner/.test(accountClosureMigration) &&
    /delete from auth\.sessions where user_id = \$1/.test(accountClosureMigration) &&
    /grant execute on function public\.anonymize_user_account\(uuid\) to authenticated/.test(accountClosureMigration),
  'effective account-closure migration keeps authenticated anonymization self-only, owner-blocked and session-revoking'
)

// 3. views ---------------------------------------------------------------------------
const views = [
  'company_actor_testing_status_v', 'tenant_customer_intake_tracking_v',
  'tenant_event_mail_readiness_v', 'gridex_ops_hardening_health_v',
  'tenant_contract_offer_readiness_v', 'gridex_public_contract_offer_api_diagnostics_v',
  'gridex_multiple_permissive_policy_candidates_v', 'gridex_duplicate_index_candidates_v',
  'gridex_data_cleanup_customer_candidates_v', 'gridex_tenant_usage_monthly_v',
  'gridex_actor_import_preview_v', 'gridex_grid_owner_verification_status_v',
  'gridex_public_contract_offer_admin_v', 'gridex_api_client_permission_summary_v',
  'gridex_tenant_email_dispatch_readiness_v', 'gridex_company_route_readiness_v',
  'customer_ops_master_readiness_v', 'customer_ops_timeline_v',
  'tenant_website_readiness_v', 'gridex_energy_geodata_health_v',
  'platform_grid_owner_readiness_v', 'gridex_operational_route_repair_v',
  'gridex_grid_owner_business_readiness_v', 'platform_go_live_readiness_v',
]
const missingViews = views.filter((v) => !migrationC.includes(`public.${v}`))
expect(
  missingViews.length === 0,
  `migration C covers all ${views.length} flagged SECURITY DEFINER views${missingViews.length ? ` (missing: ${missingViews.join(', ')})` : ''}`
)
expect(
  /alter view %s set \(security_invoker = true\)/.test(migrationC) &&
    !/create or replace view/i.test(migrationC) && !/drop view/i.test(migrationC),
  'views are converted in place (no drop/recreate; columns/comments preserved)'
)
expect(
  /revoke all on %s from anon/.test(migrationC) && /revoke all on %s from authenticated/.test(migrationC),
  'service-only views are revoked from anon and authenticated'
)

// 4. RLS-no-policy tables ---------------------------------------------------------------
const serviceOnlyTables = [
  'company_number_sequences', 'customer_application_intakes', 'customer_external_auth_links',
  'customer_site_address_conflicts', 'customer_site_address_history', 'document_parse_jobs',
  'ediel_production_send_approvals', 'gridex_performance_hardening_events',
  'integration_api_client_profiles', 'integration_api_permission_groups',
  'legal_bundle_items', 'legal_bundles', 'onboarding_choices', 'onboarding_sessions',
  'onboarding_steps', 'platform_go_live_route_simulations', 'platform_usage_events',
  'price_book_lines', 'price_books', 'tenant_email_outbox_runs', 'tenant_launch_states',
]
const missingTables = serviceOnlyTables.filter((t) => !migrationD.includes(`public.${t}`))
expect(
  missingTables.length === 0,
  `migration D covers all ${serviceOnlyTables.length} service-only tables${missingTables.length ? ` (missing: ${missingTables.join(', ')})` : ''}`
)
expect(
  !/using\s*\(\s*true\s*\)/i.test(batch) && !/with check\s*\(\s*true\s*\)/i.test(batch),
  'no using(true)/with check(true) policies anywhere in the hardening batch'
)
expect(
  migrationD.includes('customer_operation_jobs_tenant_read') &&
    /for select\s+to authenticated/.test(migrationD) &&
    /gridex_user_is_platform_admin\(\)\s*or public\.gridex_can_read_company\(company_id\)/.test(migrationD),
  'customer_operation_jobs gets exactly one narrow company-scoped SELECT policy'
)
expect(
  /revoke insert, update, delete, truncate, references, trigger on public\.customer_operation_jobs from authenticated/.test(migrationD),
  'customer_operation_jobs writes stay service-role only'
)

// 5. migration safety + auth setting -----------------------------------------------------
expect(
  [migrationA, migrationB, migrationC, migrationD].every((m) => /set lock_timeout/.test(m) && /set statement_timeout/.test(m)),
  'all hardening migrations set lock_timeout and statement_timeout'
)
expect(
  [migrationA, migrationB, migrationC, migrationD].every((m) => /to_regclass|to_regprocedure/.test(m)),
  'all hardening migrations guard object existence (safe replay)'
)
expect(
  /leaked password/i.test(envChecklist) && /leaked password/i.test(report),
  'leaked password protection documented as required manual production setting'
)
expect(
  read('docs/go-live-cutover-plan.md').includes('supabase-advisors-hardening'),
  'go-live cutover plan references the advisors hardening checklist'
)

// 6. new migrations must pin search_path on new public functions -------------------------
const migrationsDir = path.join(root, 'supabase/migrations')
const newMigrations = fs.readdirSync(migrationsDir)
  .filter((f) => /^202607(09|[1-9][0-9])|^2026(0[8-9]|1[0-2])|^202[7-9]/.test(f) && f.endsWith('.sql'))
// A function counts as pinned when EITHER its create statement pins
// search_path inline OR a later migration repairs it with
// `alter function public.<name>(...) set search_path` (applied migrations are
// immutable, so advisor repairs must be forward migrations).
const alterPinned = new Set()
for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
  for (const match of sql.matchAll(/alter function\s+public\.([a-z0-9_]+)\s*\([^)]*\)\s+set search_path/gi)) {
    alterPinned.add(match[1].toLowerCase())
  }
}
const offenders = []
for (const file of newMigrations) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8')
  const fnBlocks = sql.split(/create or replace function|create function/i).slice(1)
  for (const block of fnBlocks) {
    if (!/^\s+(public\.|if not exists\s+public\.)/i.test(block)) continue
    const head = block.slice(0, block.search(/\bas\s+\$|\bbegin\b/i) === -1 ? block.length : block.search(/\bas\s+\$|\bbegin\b/i))
    if (/set search_path/i.test(head)) continue
    const nameMatch = block.match(/^\s*(?:if not exists\s+)?public\.([a-z0-9_]+)/i)
    const functionName = nameMatch ? nameMatch[1].toLowerCase() : null
    if (functionName && alterPinned.has(functionName)) continue
    offenders.push(`${file}: public.${block.trim().slice(0, 60)}...`)
  }
}
expect(
  offenders.length === 0,
  `new migrations (>= 20260709) pin search_path on created public functions (inline or via forward alter)${offenders.length ? ` (offenders: ${offenders.join(' | ')})` : ''}`
)

console.log('\nLive verification SQL (K1-K4): docs/security/supabase-advisors-hardening.md')
process.exit(failures === 0 ? 0 : 1)
