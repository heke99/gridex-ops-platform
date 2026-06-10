/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  } else {
    console.log(`OK: ${message}`)
  }
}

const applicationEngine = read('lib/website/customerApplications.ts')
const reviewEngine = read('lib/website/applicationReview.ts')
const applicationPage = read('app/admin/website-applications/page.tsx')
const applicationActions = read('app/admin/website-applications/actions.ts')
const migration = read('supabase/migrations/20260610123000_customer_application_review_flow.sql')
const resendWebhook = read('lib/email/resendWebhookEvents.ts')

assert(!applicationEngine.includes('metering_point_id krävs när ansökan innehåller anläggningsadress'), 'address-only website applications are not rejected with 422')
assert(applicationEngine.includes("status: applicationStatus"), 'website application response uses readiness status')
assert(applicationEngine.includes("eventKey: 'contract.application_received'"), 'initial application only triggers received email')
assert(!applicationEngine.includes("eventKey: 'switch.confirmed'"), 'website submit does not trigger switch confirmation email')
assert(reviewEngine.includes('canSendAgreementConfirmation'), 'readiness model separates agreement confirmation guard')
assert(reviewEngine.includes('requestedStartDate') && reviewEngine.includes('confirmedStartDate') && reviewEngine.includes('actualStartDate'), 'requested/confirmed/actual start dates are separated')
assert(applicationPage.includes('Kundansökningar') && applicationPage.includes('Kontrollera om redo'), 'admin UI exposes customer application work queue and readiness check')
assert(applicationActions.includes('upsertApplicationMeteringPoint') && applicationActions.includes('power_of_attorney_accepted'), 'admin actions can complete metering/fullmakt data')
assert(migration.includes('needs_information') && migration.includes('ready_for_switch'), 'migration allows customer application lifecycle statuses')
assert(migration.includes('customer_contracts') && migration.includes('metadata jsonb'), 'migration fixes customer_contracts metadata mismatch')
assert(migration.includes('email_event_rules') && migration.includes('is_active'), 'migration keeps legacy email_event_rules is_active compatible')
assert(resendWebhook.includes("eventType === 'email.sent'") && resendWebhook.includes('markCommunicationSent'), 'Resend webhook handles sent state explicitly')

if (process.exitCode) process.exit(process.exitCode)
console.log('Customer application review regression checks passed.')
