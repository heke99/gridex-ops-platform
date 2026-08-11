#!/usr/bin/env node
// Regression: OPS continuation hardening batch.
//
// Static source assertions (same style as the other gridex regressions) that
// lock in the continuation-build behaviour:
//  - website intake: power_of_attorney error stage/codes, required structured
//    POA, idempotent-missing-POA inline repair, in-place partial/failed marking,
//    admin repair helper, nested JSON error contract with request_id
//  - shared customer-type normalization used by website/public-contracts/admin/external
//  - missing-facility intake uses the manual pipeline only (no parallel Ediel/Z01)
//  - manual outbox failure reconciles the linked request
//  - migrations for partial/repaired status and customer_type CHECK exist
//  - internal cron routes require a secret

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
const exists = (file) => fs.existsSync(path.join(root, file))
const ok = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

// customerApplications.ts is a public facade after the bounded-file split.
// Regress against all concrete website-intake owners so the assertions follow
// the canonical runtime instead of stale strings in the facade.
const apps = [
  'lib/website/customerApplicationShared.ts',
  'lib/website/customerApplicationSchemas.ts',
  'lib/website/customerApplicationCore.ts',
  'lib/website/customerApplicationLegal.ts',
  'lib/website/customerApplicationOnboarding.ts',
  'lib/website/customerApplicationPersistence.ts',
  'lib/website/customerApplicationRepair.ts',
  'lib/website/customerApplicationProcess.ts',
  'lib/website/customerApplicationCommunication.ts',
].map(read).join('\n')
const route = read('app/api/v1/website/customer-applications/route.ts')
const publicContracts = read('lib/website/publicContracts.ts')
const gridOwnerRequests = read('lib/energy/gridOwnerRequests.ts')
const manualOutbox = read('lib/email/manualEmailOutbox.ts')

// 1) Dedicated power_of_attorney/facility/email error stages + new codes.
ok(/\|\s*'power_of_attorney'/.test(apps), 'ErrorStage includes power_of_attorney')
ok(/\|\s*'facility_information_lookup'/.test(apps), 'ErrorStage includes facility_information_lookup')
ok(/\|\s*'email_dispatch'/.test(apps), 'ErrorStage includes email_dispatch')
for (const code of ['power_of_attorney_missing']) {
  ok(apps.includes(`code: '${code}'`), `intake defines ${code}`)
}
ok(apps.includes('idempotent_application_missing_poa'), 'intake keeps idempotent_application_missing_poa as repair fallback code')
// Whitespace/quote tolerant: the stage call may be wrapped by the formatter.
ok(apps.includes('canonicalPowerOfAttorneyId = canonicalGraph.result.power_of_attorney_id') && /await stage\('power_of_attorney', \(\) =>\s*repairMissingPoaOnIdempotentApplication\(/.test(apps), 'canonical graph persists POA atomically and idempotent repair remains under the power_of_attorney stage')

// 2) Structured POA required when the contract publishes a POA version.
ok(
  /powerOfAttorneyRequired\s*=\s*legalAcceptanceVersions\.some\(/.test(apps),
  'intake derives powerOfAttorneyRequired from published legal versions',
)
ok(
  /if \(powerOfAttorneyRequired && structuredPoa\?\.accepted !== true\)/.test(apps),
  'intake requires accepted structured POA when contract requires it',
)

// 3) Idempotent retry with complete structured POA repairs a prior result lacking it.
ok(
  apps.includes('previousHasPoa') && apps.includes('repairMissingPoaOnIdempotentApplication'),
  'idempotent replay attempts inline repair when prior result has no power_of_attorney_id',
)
ok(
  apps.includes("repaired_reason: 'idempotent_missing_power_of_attorney'") && apps.includes('website_customer_applications_inline_repair'),
  'idempotent missing POA repair is persisted and audited inline',
)
ok(
  apps.includes("code: repaired?.code ?? 'idempotent_application_missing_poa'"),
  'idempotent-missing-poa remains a fallback only when inline repair cannot complete',
)

// 4) Mid-pipeline failure updates the existing row instead of inserting a dup.
ok(apps.includes('let applicationRowId: string | null = null'), 'intake tracks the created application row id')
ok(apps.includes('applicationRowId = application.id'), 'application row id is captured after creation')
ok(apps.includes('async function markApplicationFailed('), 'markApplicationFailed helper exists')
ok(
  /applicationRowId\s*\n?\s*\?\s*await markApplicationFailed\(/.test(apps),
  'catch updates the existing row via markApplicationFailed when present',
)
ok(apps.includes('duplicateIdempotencyKey') && apps.includes('website_customer_applications_company_idempotency_uidx'), 'failed application logging updates existing idempotency row instead of crashing on duplicate key')
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
ok(apps.includes("from '@/lib/customers/externalCustomerType'") && apps.includes('normalizeExternalCustomerType'), 'website intake imports the strict external customer-type normalizer')
ok(publicContracts.includes("from '@/lib/customers/normalizeCustomerType'"), 'public-contracts imports the shared normalizer')
ok(
  /const normalized = normalizeCustomerType\(customerType\)/.test(publicContracts),
  'customerTypeAllowed normalizes the inbound customer_type',
)
ok(read('app/admin/customers/actions.ts').includes('normalizeCustomerIdentityType'), 'admin import uses normalizeCustomerIdentityType')
ok(read('lib/external-contracts/intake.ts').includes('isBusinessCustomerType'), 'external intake uses isBusinessCustomerType')

// 8) Missing-facility intake uses the manual pipeline only.
ok(
  /if \(!siteId \|\| \(!facilityId && !meteringIdentity\)\)/.test(apps) && apps.includes('processWebsiteApplicationIntake({'),
  'missing facility is routed to the manual grid-owner intake before Ediel operations',
)
ok(
  apps.indexOf('return { status, result };', apps.indexOf('if (!siteId || (!facilityId && !meteringIdentity))')) <
    apps.indexOf('const next = await evaluateAndRunNextCustomerStep', apps.indexOf('if (!siteId || (!facilityId && !meteringIdentity))')),
  'Z01 or supplier-switch evaluation only runs after the missing-facility branch returns',
)
// The website flow now delegates the missing-facility case to the shared
// customer-intake orchestrator, which owns the manual information request.
ok(
  apps.includes('processWebsiteApplicationIntake(') &&
    read('lib/customer-operations/customerIntakeOrchestrator.ts').includes('requestMissingFacilityInformation('),
  'missing-facility path calls the manual orchestrator',
)
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
