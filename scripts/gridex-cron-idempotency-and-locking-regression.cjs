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

const automationFacade = 'lib/customer-operations/automation.ts'
const automation = 'lib/customer-operations/automation.part-3.ts'
const resume = 'lib/ediel/intent/resumeStuckIntents.ts'
const resumeHelper = 'lib/ediel/intent/edielResumeFairClaim.ts'
const resumeClaim = 'supabase/migrations/20261001012959_ediel_resume_tenant_fair_claim.sql'
const migration = 'supabase/migrations/20260707120000_gridex_pipeline_hardening_guards.sql'
const spotCron = 'app/api/cron/pricing/spot-prices/route.ts'

// Worker error persistence: full technical context, never a collapsed message.
mustInclude(automationFacade, "export { processCustomerOperationJobs } from './automation.part-3'", 'the public worker facade must bind the actual characterized implementation')
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
mustInclude(resume, "await claimEdielResumeIntents({phase:'validated'", 'validated work must originate from the fair atomic claim')
mustInclude(resume, "await claimEdielResumeIntents({phase:'draft'", 'draft work must originate from the fair atomic claim')
mustInclude(resume, 'await checkEdielResumeClaim(claim)', 'the current token, phase and public intent stamp must qualify before work')
mustInclude(resume, 'await finishEdielResumeClaim(claim,outcome)', 'completion must remain tied to the actual claimed token')
const resumeSrc = read(resume)
const currentCheck = resumeSrc.indexOf('await checkEdielResumeClaim(claim)')
for (const dispatcher of ['dispatchFacilityLookupEdifact({', 'prepareAndQueueProdatSwitch({', 'prepareAndQueueProdatZ01FromDataRequest({', 'prepareAndQueueUtiltsE66({', 'prepareAndQueueUtiltsE73({']) {
  const dispatch = resumeSrc.indexOf(dispatcher)
  if (currentCheck < 0 || dispatch < currentCheck) failures.push(`current resume claim check must precede ${dispatcher}`)
}
for (const rpc of ['gridex_claim_ediel_resume_intents_fair_v1', 'gridex_check_ediel_resume_claim_v1', 'gridex_finish_ediel_resume_claim_v1']) {
  mustInclude(resumeHelper, `supabaseService.rpc('${rpc}'`, 'the actual adapter must use the atomic service-only claim corridor')
}
for (const binding of ['p_company_id:claim.intent.company_id', 'p_intent_id:claim.intent.id', 'p_phase:claim.phase', 'p_claim_token:claim.claimToken']) {
  mustInclude(resumeHelper, binding, 'check/completion must bind the actual company, resource, phase and token')
}
for (const boundary of [
  "current_user<>'service_role'",
  "c.status in('active','onboarding')",
  'for update of i skip locked',
  'where ediel_resume_claims.company_id=excluded.company_id',
  'ediel_resume_claims.finished_at is not null or ediel_resume_claims.expires_at<v_now',
  'v_lease.phase=p_phase and v_lease.claim_token=p_claim_token and v_lease.finished_at is null',
  'v_lease.expires_at>=clock_timestamp() and v_lease.intent_updated_at=v_intent.updated_at',
  'v_lease.claim_token is distinct from p_claim_token',
]) {
  mustInclude(resumeClaim, boundary, 'the real SQL claim/check/completion must preserve current ownership, stamp, token and active-lease CAS')
}

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
