const fs = require('node:fs')

const baseHealthPath = 'supabase/migrations/20260809110000_ops_health_status_qualification.sql'
const liveRoutePath = 'supabase/migrations/20260811155412_ops_health_live_route_qualification.sql'
const v5Path = 'supabase/migrations/20260812113000_gridex_ops_masterdata_health_v5.sql'
const dynamicPath = 'supabase/migrations/20260812114500_gridex_ops_health_v5_dynamic_receiver_semantics.sql'
const serviceRolePath = 'supabase/migrations/20260812121100_gridex_ops_health_v5_service_role_only.sql'
const roleAwareCountsPath = 'supabase/migrations/20260812130500_gridex_ops_health_v5_role_aware_counts.sql'
const identifierNormalizationPath = 'supabase/migrations/20260812151500_gridex_ops_grid_owner_identifier_normalization_v3.sql'
const healthPath = 'lib/ops/health.ts'
const svkPath = 'lib/energy/svkGeometryImport.ts'

const failures = []
const readRequired = (path, label) => {
  if (!fs.existsSync(path)) {
    failures.push(`missing ${label} input: ${path}`)
    return ''
  }
  return fs.readFileSync(path, 'utf8')
}

const baseHealth = readRequired(baseHealthPath, 'health hotfix')
const liveRoute = readRequired(liveRoutePath, 'v4 live-route health')
const v5 = readRequired(v5Path, 'v5 canonical remediation')
const dynamic = readRequired(dynamicPath, 'dynamic receiver semantics')
const serviceRole = readRequired(serviceRolePath, 'v5 service-role boundary')
const roleAwareCounts = readRequired(roleAwareCountsPath, 'role-aware PRODAT accounting')
const identifierNormalization = readRequired(identifierNormalizationPath, 'grid-owner identifier normalization')
const health = readRequired(healthPath, 'health runtime')
const svk = readRequired(svkPath, 'SVK importer')

const requireMarkers = (source, label, markers) => {
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`missing ${label} marker: ${marker}`)
  }
}

requireMarkers(baseHealth, 'health hotfix', [
  "email_outbox.status =",
  "webhook.status =",
  "ediel.status =",
  "conflict_row.status =",
  "site.status =",
  "v_replacements <> 5",
  "pg_get_functiondef('public.gridex_ops_health_checks()'::regprocedure)",
])

for (const raw of [
  String.raw`from public.tenant_email_outbox\n  where status =`,
  String.raw`from public.webhook_deliveries\n  where status =`,
  String.raw`from public.ediel_outbox\n  where status =`,
  String.raw`from public.customer_site_address_conflicts\n    where status =`,
  String.raw`from public.customer_sites\n  where status =`,
]) {
  if (!baseHealth.includes(raw)) failures.push(`missing fail-closed source signature: ${raw}`)
}

requireMarkers(liveRoute, 'v4 live-route health', [
  'gridex_ops_health_checks_v4',
  "production_mode, 'disabled') = 'live'",
  'is_production_ready',
  'route:candidate_receiver_or_mailbox_missing',
  'route:candidate_receiver_certificate_invalid_or_missing',
  'reference_masterdata_not_live_customer_state',
])

requireMarkers(v5, 'v5 canonical remediation', [
  'gridex_reconcile_grid_owner_mappings_v1',
  'p_apply boolean',
  'ops_reconciliation',
  'review_required',
  'gridex_ops_health_checks_v5',
  'masterdata:grid_owner_prodat_action_required',
  'masterdata:grid_owner_prodat_out_of_scope_inventory',
  'masterdata:grid_area_ops_owner_mapping_review',
])

// Reconciliation may surface fuzzy/alias candidates for review, but must never
// allow fuzzy matching itself to authorize a production write.
requireMarkers(v5, 'reconciliation fail-closed', [
  'fuzzy_write_allowed',
  'candidate_count',
  'match_method',
])
if (!/fuzzy_write_allowed[^\n]*false/i.test(v5)) {
  failures.push('reconciliation no longer records fuzzy_write_allowed=false')
}

requireMarkers(dynamic, 'dynamic receiver semantics', [
  'dynamic_grid_owner',
  'selected_metering_point_grid_owner',
  'route:dynamic_receiver_candidate_templates',
  'route:dynamic_receiver_candidate_template_invalid',
  'route:non_live_certificate_candidate_inventory',
])

requireMarkers(serviceRole, 'v5 service-role boundary', [
  'revoke execute on function public.gridex_ops_health_checks_v5() from authenticated',
  'grant execute on function public.gridex_ops_health_checks_v5() to service_role',
])

requireMarkers(roleAwareCounts, 'role-aware PRODAT accounting', [
  'role_aware_blocking_reasons',
  'missing_or_invalid_certificate',
])

requireMarkers(identifierNormalization, 'grid-owner identifier normalization', [
  'identifier_type_normalized',
  "= 'edielid'",
  "'orgno'",
  "'orgnumber'",
  "'orgnr'",
  "'organizationnumber'",
  "'engine_version', 3",
  "'fuzzy_write_allowed', false",
  'to service_role',
])
if (/i\.identifier_type\s*=\s*'ediel_id'/i.test(identifierNormalization)) {
  failures.push('identifier normalization regressed to an exact ediel_id-only comparison')
}
if (/i\.identifier_type\s*=\s*'organization_number'/i.test(identifierNormalization)) {
  failures.push('identifier normalization regressed to an exact organization_number-only comparison')
}

requireMarkers(health, 'health runtime', [
  "supabaseService.rpc('gridex_ops_health_checks_v5')",
  "supabaseService.rpc('gridex_ops_health_checks_v4')",
  "supabaseService.rpc('gridex_ops_health_checks_v3')",
])
const v5Pos = health.indexOf("supabaseService.rpc('gridex_ops_health_checks_v5')")
const v4Pos = health.indexOf("supabaseService.rpc('gridex_ops_health_checks_v4')")
const v3Pos = health.indexOf("supabaseService.rpc('gridex_ops_health_checks_v3')")
if (!(v5Pos >= 0 && v5Pos < v4Pos && v4Pos < v3Pos)) {
  failures.push('OPS health expand/deploy fallback order must be v5 -> v4 -> v3')
}

requireMarkers(svk, 'SVK final-promotion reconciliation', [
  "supabaseService.rpc('gridex_promote_energy_geodata_version'",
  "supabaseService.rpc('gridex_reconcile_grid_owner_mappings_v1'",
  'p_apply: true',
])
const finalOnly = svk.indexOf('if (!hasMore)')
const promote = svk.indexOf("supabaseService.rpc('gridex_promote_energy_geodata_version'", finalOnly)
const reconcile = svk.indexOf("supabaseService.rpc('gridex_reconcile_grid_owner_mappings_v1'", finalOnly)
if (!(finalOnly >= 0 && promote > finalOnly && reconcile > promote)) {
  failures.push('SVK reconciliation must run only after final successful geodata promotion')
}

if (failures.length) {
  console.error(`OPS health/remediation regression failed (${failures.length} issue(s)):`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('OPS health/remediation regression passed (v5 scope, dynamic routing, service boundary, identifier normalization and final-promotion reconciliation verified).')
