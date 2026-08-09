const fs = require('node:fs')

const migrationPath = 'supabase/migrations/20260809110000_ops_health_status_qualification.sql'
const healthPath = 'lib/ops/health.ts'
const migration = fs.readFileSync(migrationPath, 'utf8')
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

for (const raw of [
  "from public.tenant_email_outbox\\n  where status =",
  "from public.webhook_deliveries\\n  where status =",
  "from public.ediel_outbox\\n  where status =",
  "from public.customer_site_address_conflicts\\n    where status =",
  "from public.customer_sites\\n  where status =",
]) {
  if (!migration.includes(raw)) failures.push(`missing fail-closed source signature: ${raw}`)
}

if (!health.includes("supabaseService.rpc('gridex_ops_health_checks_v3')")) {
  failures.push('OPS health runtime no longer calls gridex_ops_health_checks_v3')
}

if (failures.length) {
  console.error(`OPS health regression failed (${failures.length} issue(s)):`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('OPS health regression passed (status qualification hotfix and v3 runtime call verified).')
