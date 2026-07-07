/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: worker failures preserve real DB error context (code/details/
// hint + stage + IDs + retryability), the resume sweep uses claim semantics so
// two workers cannot revive the same intent, and DB-level idempotency guards
// exist for manual e-mail outbox, intents, inbound messages and the
// customer_masterdata outbound facility guard.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}

const automation = 'lib/customer-operations/automation.ts'
const resume = 'lib/ediel/intent/resumeStuckIntents.ts'
const migration = 'supabase/migrations/20260707120000_gridex_pipeline_hardening_guards.sql'
const spotCron = 'app/api/cron/pricing/spot-prices/route.ts'

// Worker error persistence: full technical context, never a collapsed message.
for (const needle of [
  'technical_error: technicalError',
  'stage: job.job_type',
  'hint: clean(pgError?.hint',
  'details: clean(pgError?.details',
  'code: clean(pgError?.code',
  'worker_id: input.workerId',
  'attempt: job.attempts',
  'retryable: !terminal',
  'next_retry_at',
  'last_attempted_at',
]) {
  mustInclude(automation, needle, 'worker failure must persist full technical error context')
}
// Terminal states keep the error message (no more last_error: null on needs_review).
const automationSrc = read(automation)
if (/last_error:\s*reviewTerminal\s*\?\s*null/.test(automationSrc)) {
  failures.push('terminal needs_review jobs must not clear last_error')
}

// Resume sweep claim semantics.
mustInclude(resume, 'Optimistic claim', 'resume sweep must claim intents before dispatching')
mustInclude(resume, ".eq('updated_at', row.updated_at)", 'compare-and-set claim on the stuck state')

// Existing strong locks remain (claim RPCs with SKIP LOCKED).
mustInclude('supabase/migrations/20260618200000_ops_production_hardening_resolver_queues.sql', 'skip locked', 'customer operation job claim RPC keeps FOR UPDATE SKIP LOCKED')

// DB migration guards.
mustInclude(migration, 'manual_email_outbox_company_idempotency_uidx', 'tenant-scoped manual outbox idempotency')
mustInclude(migration, "idempotency_key = 'legacy:' || id::text", 'intent NULL idempotency keys backfilled')
mustInclude(migration, 'manual_inbound_messages_provider_message_uidx', 'inbound double-ingestion guard')
mustInclude(migration, 'gridex_validate_outbound_payload', 'DB-level customer_masterdata facility guard')
mustInclude(migration, "'facility_or_metering_point_missing'", 'guard applies canonical blocker code')
const migrationSrc = read(migration)
if (/drop\s+policy|disable\s+row\s+level\s+security|drop\s+trigger\s+if\s+exists\s+gridex_audit/i.test(migrationSrc)) {
  failures.push('hardening migration must not weaken RLS/audit')
}

// Cron auth timing-safety.
mustInclude(spotCron, 'timingSafeEqual', 'spot price cron must use timing-safe secret comparison')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-cron-idempotency-and-locking-regression: all checks passed')
