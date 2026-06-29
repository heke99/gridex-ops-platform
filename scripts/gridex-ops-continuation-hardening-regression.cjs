#!/usr/bin/env node
// Regression: OPS continuation hardening batch.
//
// Static source assertions (same style as the other gridex regressions) that
// lock in the continuation-build behaviour:
//  - website intake: power_of_attorney error stage/codes, required structured
//    POA, idempotent-missing-POA, in-place partial/failed marking, repair helper,
//    nested JSON error contract with request_id
//  - shared customer-type normalization used by website/public-contracts/admin/external
//  - missing-facility intake uses the manual pipeline only (no parallel Ediel/Z01)
//  - manual outbox failure reconciles the linked request
//  - migrations for partial/repaired status and customer_type CHECK exist
//  - internal cron routes require a secret

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))
const ok = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

const apps = read('lib/website/customerApplications.ts')
const route = read('app/api/v1/website/customer-applications/route.ts')
const publicContracts = read('lib/website/publicContracts.ts')
const gridOwnerRequests = read('lib/energy/gridOwnerRequests.ts')
const manualOutbox = read('lib/email/manualEmailOutbox.ts')

// 1) Dedicated power_of_attorney error stage + new codes.
ok(/\|\s*'power_of_attorney'/.test(apps), 'ErrorStage includes power_of_attorney')
ok(/\|\s*'facility_lookup'/.test(apps), 'ErrorStage includes facility_lookup')
ok(/\|\s*'email_dispatch'/.test(apps), 'ErrorStage includes email_dispatch')
for (const code of ['power_of_attorney_missing', 'idempotent_application_missing_poa']) {
  ok(apps.includes(`code: '${code}'`), `intake defines ${code}`)
}
ok(apps.includes("await stage('power_of_attorney', () => ensureWebsitePowerOfAttorney("), 'POA persistence runs under the power_of_attorney stage')

// 2) Structured POA required when the contract publishes a POA version.
ok(
  /powerOfAttorneyRequired\s*=\s*legalAcceptanceVersions\.some\(/.test(apps),
  'intake derives powerOfAttorneyRequired from published legal versions',
)
ok(
  /if \(powerOfAttorneyRequired && structuredPoa\?\.accepted !== true\)/.test(apps),
  'intake requires accepted structured POA when contract requires it',
)

// 3) Idempotent retry with new POA but prior result lacking it -> 409.
ok(
  apps.includes('previousHasPoa') && apps.includes("code: 'idempotent_application_missing_poa'"),
  'idempotent replay blocks when prior result has no power_of_attorney_id',
)
ok(apps.includes("action: 'retry_with_new_idempotency_key_or_repair'"), 'idempotent-missing-poa returns a retry/repair action')

// 4) Mid-pipeline failure updates the existing row instead of inserting a dup.
ok(apps.includes('let applicationRowId: string | null = null'), 'intake tracks the created application row id')
ok(apps.includes('applicationRowId = application.id'), 'application row id is captured after creation')
ok(apps.includes('async function markApplicationFailed('), 'markApplicationFailed helper exists')
ok(
  /applicationRowId\s*\n?\s*\?\s*await markApplicationFailed\(/.test(apps),
  'catch updates the existing row via markApplicationFailed when present',
)
ok(/power_of_attorney_id:\s*null/.test(apps), 'failed application response clears power_of_attorney_id')
ok(/const genericFailureStatus = applicationRowId \? 'partial' : 'failed'/.test(apps), 'mid-pipeline failure uses partial status')

// 5) Repair helper + admin action.
ok(apps.includes('export async function repairWebsiteCustomerApplication('), 'repairWebsiteCustomerApplication helper exists')
{
  const actions = read('app/admin/website-applications/actions.ts')
  ok(actions.includes('repairWebsiteApplicationPowerOfAttorneyAction'), 'admin repair action exists')
  ok(actions.includes('repairWebsiteCustomerApplication('), 'admin action calls the repair helper')
  ok(actions.includes('authorizeForCompany('), 'admin repair action is guarded (platform or company-scoped)')
}

// 6) Nested JSON error contract with request_id.
ok(route.includes('function buildErrorBody('), 'route builds the standard error body')
{
  // Scope the field checks to the nested error object in buildErrorBody.
  const errIdx = route.indexOf('error: {')
  ok(errIdx > -1, 'route returns a nested error object')
  const errBlock = route.slice(errIdx, errIdx + 400)
  for (const field of ['code', 'message', 'stage', 'field', 'request_id']) {
    ok(new RegExp(`\\b${field}\\b`).test(errBlock), `error contract exposes ${field}`)
  }
}
ok(route.includes('const requestId = randomUUID()'), 'route generates a request_id')

// 7) Shared customer-type normalization used everywhere.
ok(exists('lib/customers/normalizeCustomerType.ts'), 'shared normalizeCustomerType module exists')
const normalizeSrc = read('lib/customers/normalizeCustomerType.ts')
ok(/export function normalizeCustomerType\(/.test(normalizeSrc), 'normalizeCustomerType is exported')
ok(/export function normalizeCustomerIdentityType\(/.test(normalizeSrc), 'normalizeCustomerIdentityType is exported')
{
  // Mirror the alias contract and assert the documented mappings hold.
  const priv = ['private', 'privat', 'consumer', 'person', 'privatperson', 'individual']
  const biz = ['business', 'company', 'foretag', 'företag', 'corporate', 'organization', 'organisation', 'enterprise', 'b2b']
  for (const alias of priv) ok(normalizeSrc.includes(`'${alias}'`), `private alias ${alias} present`)
  for (const alias of biz) ok(normalizeSrc.includes(`'${alias}'`), `business alias ${alias} present`)
}
ok(apps.includes("from '@/lib/customers/normalizeCustomerType'"), 'website intake imports the shared normalizer')
ok(publicContracts.includes("from '@/lib/customers/normalizeCustomerType'"), 'public-contracts imports the shared normalizer')
ok(
  /const normalized = normalizeCustomerType\(customerType\)/.test(publicContracts),
  'customerTypeAllowed normalizes the inbound customer_type',
)
ok(read('app/admin/customers/actions.ts').includes('normalizeCustomerIdentityType'), 'admin import uses normalizeCustomerIdentityType')
ok(read('lib/external-contracts/intake.ts').includes('isBusinessCustomerType'), 'external intake uses isBusinessCustomerType')

// 8) Missing-facility intake uses the manual pipeline only.
ok(
  /const gridOwnerRequestMayBeCreated = readiness\.canRequestGridOwnerInformation && !facilityMissing/.test(apps),
  'Ediel grid-owner request is not created when facility is missing',
)
ok(
  /if \(committedSiteId && powerOfAttorneyId && !facilityMissing\)/.test(apps),
  'Z01-first automation is skipped when facility is missing',
)
ok(apps.includes('requestMissingFacilityInformation('), 'missing-facility path calls the manual orchestrator')
ok(gridOwnerRequests.includes('existingOpenManualRequest('), 'Ediel creator checks for an open manual request')
ok(gridOwnerRequests.includes("'manual_request_in_progress'"), 'Ediel creator skips when a manual request is open')

// 9) Manual outbox failure reconciles the linked request.
ok(manualOutbox.includes('async function markLinkedRequestFailed('), 'markLinkedRequestFailed helper exists')
ok(/status: 'needs_review'/.test(manualOutbox), 'failed outbox moves request to needs_review')
ok(/dispatch_status: 'failed'/.test(manualOutbox), 'failed outbox sets dispatch_status failed')

// 10) Migrations.
ok(exists('supabase/migrations/20260629140000_website_application_partial_repaired_status.sql'), 'partial/repaired status migration exists')
{
  const mig = read('supabase/migrations/20260629140000_website_application_partial_repaired_status.sql')
  ok(mig.includes("'partial'") && mig.includes("'repaired'"), 'status migration adds partial and repaired')
}
ok(exists('supabase/migrations/20260629150000_customers_customer_type_canonicalization.sql'), 'customer_type canonicalization migration exists')
{
  const mig = read('supabase/migrations/20260629150000_customers_customer_type_canonicalization.sql')
  ok(/customers_customer_type_check/.test(mig), 'migration adds customers_customer_type_check')
  ok(mig.includes("in ('private','business','association')"), 'customer_type CHECK allows private/business/association')
}

// 11) Internal cron routes require a secret.
for (const file of [
  'app/api/internal/manual-email/outbox/process/route.ts',
  'app/api/internal/customer-operations/cron/route.ts',
]) {
  ok(exists(file), `${file} exists`)
  ok(/CRON_SECRET/.test(read(file)), `${file} requires a cron secret`)
}

console.log('\nAll OPS continuation hardening regression checks passed.')
