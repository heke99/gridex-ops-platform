const fs = require('node:fs')

const migrationPath = 'supabase/migrations/20260809110000_ops_health_status_qualification.sql'
const liveRouteMigrationPath = 'supabase/migrations/20260811155412_ops_health_live_route_qualification.sql'
const healthPath = 'lib/ops/health.ts'
const migration = fs.readFileSync(migrationPath, 'utf8')
const liveRouteMigration = fs.readFileSync(liveRouteMigrationPath, 'utf8')
const health = fs.readFileSync(healthPath, 'utf8')

const required = [
  "email_outbox.status =",
  "webhook.status =",
  "ediel.status =",
  "conflict_row.status =",
  "site.status =",
  "v_replacements <> 5",
  "pg_get_functiondef('public.gridex_ops_health_checks()'::regprocedure)",
]

const failures = []
for (const marker of required) {
  if (!migration.includes(marker)) failures.push(`missing health hotfix marker: ${marker}`)
}

// The forward-only migration intentionally matches the installed function with
// PostgreSQL E-string newline escapes ("\\n"). Verify that immutable source
// representation exactly; interpreting \n as a JavaScript newline would assert
// a byte sequence that does not exist in the migration file.
for (const raw of [
  String.raw`from public.tenant_email_outbox\n  where status =`,
  String.raw`from public.webhook_deliveries\n  where status =`,
  String.raw`from public.ediel_outbox\n  where status =`,
  String.raw`from public.customer_site_address_conflicts\n    where status =`,
  String.raw`from public.customer_sites\n  where status =`,
]) {
  if (!migration.includes(raw)) failures.push(`missing fail-closed source signature: ${raw}`)
}

for (const marker of [
  'gridex_ops_health_checks_v4',
  "production_mode, 'disabled') = 'live'",
  'is_production_ready',
  'route:candidate_receiver_or_mailbox_missing',
  'route:candidate_receiver_certificate_invalid_or_missing',
  'reference_masterdata_not_live_customer_state',
]) {
  if (!liveRouteMigration.includes(marker)) failures.push(`missing live-route health marker: ${marker}`)
}

if (!health.includes("supabaseService.rpc('gridex_ops_health_checks_v4')")) {
  failures.push('OPS health runtime no longer calls gridex_ops_health_checks_v4')
}
if (!health.includes("supabaseService.rpc('gridex_ops_health_checks_v3')")) {
  failures.push('OPS health expand/deploy fallback to v3 is missing')
}

if (failures.length) {
  console.error(`OPS health regression failed (${failures.length} issue(s)):`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('OPS health regression passed (status qualification and live-route readiness qualification verified).')
