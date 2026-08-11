/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
function read(file) {
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  } else {
    console.log(`OK: ${message}`)
  }
}

// customerApplications.ts is a bounded public facade. Assert behavior against
// the concrete modules that now own processing, communication, onboarding and
// shared error/status contracts.
const applicationFacade = read('lib/website/customerApplications.ts')
const applicationProcess = read('lib/website/customerApplicationProcess.ts')
const applicationCommunication = read('lib/website/customerApplicationCommunication.ts')
const applicationOnboarding = read('lib/website/customerApplicationOnboarding.ts')
const applicationShared = read('lib/website/customerApplicationShared.ts')
const websiteApplicationRuntime = [
  applicationFacade,
  applicationProcess,
  applicationCommunication,
  applicationOnboarding,
  applicationShared,
].join('\n')
const reviewEngine = read('lib/website/applicationReview.ts')
const applicationPage = read('app/admin/website-applications/page.tsx')
const applicationActions = read('app/admin/website-applications/actions.ts')
const migration = read('supabase/migrations/20260610123000_customer_application_review_flow.sql')
const hardeningMigration = read('supabase/migrations/20260610171000_customer_application_status_hardening.sql')
const contractSourceMigration = read('supabase/migrations/20260610185000_customer_contract_source_type_idempotency.sql')
const contractStatusMigration = read('supabase/migrations/20260610192000_customer_contract_status_alignment.sql')
const sqlChecks = read('scripts/sql/customer_application_review_checks.sql')
const resendWebhook = read('lib/email/resendWebhookEvents.ts')

assert(!applicationProcess.includes('metering_point_id krävs när ansökan innehåller anläggningsadress'), 'address-only website applications are not rejected with 422')
assert(applicationProcess.includes('status: applicationStatus'), 'website application response uses readiness status')
// application_received is always queued. Confirmation/cooling-off are gated by
// signed-contract legal evidence and are therefore not emitted by an initial
// unsigned application.
assert(
  applicationCommunication.includes("'contract.application_received',") &&
    /legalMailReady\s*\?\s*\['contract\.confirmation_sent', 'contract\.cooling_off_sent'\]\s*:\s*\[\]/.test(applicationCommunication),
  'initial application only triggers received email',
)
assert(!applicationProcess.includes("'switch.confirmed'") && !applicationCommunication.includes("'switch.confirmed'"), 'website submit does not trigger switch confirmation email')
assert(reviewEngine.includes('canSendAgreementConfirmation'), 'readiness model separates agreement confirmation guard')
assert(reviewEngine.includes('requestedStartDate') && reviewEngine.includes('confirmedStartDate') && reviewEngine.includes('actualStartDate'), 'requested/confirmed/actual start dates are separated')
assert(applicationPage.includes('Kundansökningar') && applicationPage.includes('Kontrollera om redo'), 'admin UI exposes customer application work queue and readiness check')
assert(applicationActions.includes('upsertApplicationMeteringPoint') && applicationActions.includes('power_of_attorney_accepted'), 'admin actions can complete metering/fullmakt data')
assert(migration.includes('needs_information') && migration.includes('ready_for_switch'), 'migration allows customer application lifecycle statuses')
assert(hardeningMigration.includes('customers_intake_status_check') && hardeningMigration.includes('ready_for_operations') && hardeningMigration.includes('needs_completion'), 'hardening migration remaps old invalid customer intake statuses before recreating constraint')
assert(
  reviewEngine.includes('customerIntakeStatusForReadiness') &&
    applicationShared.includes('customerIntakeStatusForReadiness') &&
    applicationOnboarding.includes('customerIntakeStatusForReadiness') &&
    applicationActions.includes('customerIntakeStatusForReadiness'),
  'customer intake status is mapped to production-safe customer statuses',
)
assert(!websiteApplicationRuntime.includes("intake_status: readiness.status === 'needs_information' ? 'missing_fields' : readiness.status"), 'runtime no longer writes website lifecycle statuses into customers.intake_status')
assert(applicationProcess.includes("stage('customer_intake_update'"), 'customer intake update has a precise error stage')
assert(applicationProcess.includes('technicalBlockingReason') && applicationProcess.includes('missingFields: readiness.missingFields'), 'failed application logging preserves missing fields and technical blocking reason')
assert(applicationPage.includes('safeOperationalMessage') && applicationPage.includes('Tekniskt fel kräver åtgärd'), 'admin UI sanitizes raw database errors and treats failed rows as blocking')
assert(migration.includes('customer_contracts') && migration.includes('metadata jsonb') && hardeningMigration.includes('customer_contracts'), 'migrations fix customer_contracts metadata/start-date mismatch')
assert(contractSourceMigration.includes('customer_contracts_source_type_check') && contractSourceMigration.includes("'website_application'") && contractSourceMigration.includes('customer_contracts_website_application_retry_idx'), 'contract source migration accepts website applications and adds retry lookup index')
assert(contractStatusMigration.includes('customer_contracts_status_check') && contractStatusMigration.includes("'pending_signature'") && contractStatusMigration.includes("where status = 'pending'"), 'contract status migration normalizes pending to pending_signature and keeps canonical DB statuses')
assert(
  applicationProcess.includes('onboardCanonicalWebsiteCustomerGraph') &&
    applicationOnboarding.includes('onboardCustomerGraph') &&
    applicationOnboarding.includes('canonicalIdempotencyKey') &&
    applicationOnboarding.includes('WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE'),
  'website API contract creation uses canonical atomic onboarding, canonical idempotency and website source type',
)
assert(applicationActions.includes('findExistingApplicationContract') && applicationActions.includes('WEBSITE_APPLICATION_CONTRACT_SOURCE_TYPE'), 'admin review retry reuses existing website application contracts')
assert(!/source_type:\s*'website_application_review'/.test(applicationActions), 'admin review no longer inserts review-only contract source_type')
assert(migration.includes('email_event_rules') && migration.includes('is_active'), 'migration keeps legacy email_event_rules is_active compatible')
assert(resendWebhook.includes("eventType === 'email.sent'") && resendWebhook.includes('markCommunicationSent'), 'Resend webhook handles sent state explicitly')
assert(sqlChecks.includes('recipient_email') && !sqlChecks.includes('to_email'), 'SQL checks use live communication_logs recipient_email column')
assert(sqlChecks.includes('grid_owners') && !sqlChecks.includes('market_actors'), 'SQL checks use live grid_owners table, not missing market_actors')
assert(sqlChecks.includes('customer_contracts_source_type_check') && sqlChecks.includes('customer_contracts_status_check') && sqlChecks.includes('customer_contracts'), 'SQL checks verify customer contract source/status constraints and created contracts')
assert(reviewEngine.includes('grid_owner_id_not_verified_uuid'), 'readiness warns when placeholder grid_owner_id is not a verified UUID')
assert(applicationShared.includes('Avtal kunde inte skapas eftersom kundavtalets source_type inte stöds av databasen'), 'contract source-type errors are reported as clean operational messages')
assert(
  applicationShared.includes("WEBSITE_APPLICATION_READY_CONTRACT_STATUS = 'pending_signature'") &&
    applicationOnboarding.includes('const contractStatus = WEBSITE_APPLICATION_READY_CONTRACT_STATUS') &&
    !websiteApplicationRuntime.includes("const contractStatus = readiness.canStartSwitch ? 'pending' : 'draft'"),
  'website API uses canonical pending_signature contract status instead of invalid pending',
)
assert(applicationActions.includes("WEBSITE_APPLICATION_READY_CONTRACT_STATUS = 'pending_signature'") && !applicationActions.includes("status: readiness.canStartSwitch ? 'pending' : 'draft'"), 'admin review retry uses canonical pending_signature contract status instead of invalid pending')
assert(applicationShared.includes('customer_contracts_status_check') && applicationPage.includes('customer_contracts_status_check'), 'contract status constraint errors are classified separately from source_type errors')

if (process.exitCode) process.exit(process.exitCode)
console.log('Customer application review regression checks passed.')
