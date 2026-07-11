/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: superadmin diagnostics expose the technical truth (recipient
// resolution, safe-override warnings, dirty test data, Z01 repair, technical
// IDs) while tenants never receive that data.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}

const card = 'components/admin/customers/CustomerBusinessActionsCard.tsx'
const summary = 'lib/customer-operations/manualRequestSummary.ts'
const page = 'app/admin/customers/[id]/page.tsx'
const emailActions = 'app/admin/customers/[id]/email-actions.ts'

// Recipient resolution diagnostics (superadmin only).
mustInclude(summary, 'includeRecipientResolution', 'resolution loading is opt-in')
mustInclude(summary, 'Superadmin diagnostics only', 'tenant summaries stay clean')
mustInclude(page, 'includeRecipientResolution: isPlatformAdmin', 'page gates resolution to platform admins')
mustInclude(card, 'isPlatformAdmin && request.recipientResolution', 'resolution panel is platform-admin gated')
mustInclude(card, 'Säker intern mottagare (override)', 'override mode labelled clearly')
mustInclude(card, 'Produktionsutskick med säker intern mottagare', 'production safe-override warning banner')

// Dirty test data warning (superadmin only).
mustInclude(card, 'isPlatformAdmin && showTechnicalDiagnostics && isTestData', 'test data banner gated to the separate platform diagnostics view')
mustInclude(card, 'får inte\n            användas som bevis för produktionsflödet', 'banner explains dirty rows are not production proof')
mustInclude(page, 'isTestData={customer.is_test_data === true}', 'page feeds the flag from the customer row')

// Z01 repair panel + technical details remain superadmin capabilities.
mustInclude(card, 'isPlatformAdmin && showTechnicalDiagnostics && (workflow.canRunRepair || workflow.canContinueFinalization)', 'Z01 repair panel isolated to platform diagnostics')
mustInclude(card, 'Tekniska detaljer och felsökning', 'technical detail expansion intact')

// Resend action uses explicit resend-scoped idempotency + provenance.
mustInclude(emailActions, 'resend:${log.id}:${resendBucket}', 'resend idempotency key derived from original log')
mustInclude(emailActions, 'resend_of_communication_log_id', 'resend provenance recorded')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-superadmin-diagnostics-ui-regression: all checks passed')
