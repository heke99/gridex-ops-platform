/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: the missing-facility manual grid-owner request path must keep
// request/outbox/site statuses in sync, persist configuration blockers with a
// request id, use request-scoped idempotency and reflect delivery_uncertain on
// the linked request. Grid-owner replies with only anläggnings-ID must be
// applicable when the site already carries the grid area.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}
function mustNotInclude(file, needle, why) {
  if (read(file).includes(needle)) failures.push(`Forbidden "${needle}" in ${file} (${why})`)
}

const rmfi = 'lib/customer-operations/requestMissingFacilityInformation.ts'
const outbox = 'lib/email/manualEmailOutbox.ts'
const parser = 'lib/customer-operations/manualFacilityResponseParser.ts'
const orchestrator = 'lib/customer-operations/customerIntakeOrchestrator.ts'
const lookupAutomation = 'lib/customer-operations/facilityLookupAutomation.ts'
const blockers = 'lib/customer-operations/blockers.ts'
const workQueue = 'app/admin/work-queue/page.tsx'

// 1. Persisted configuration blockers (request_id always available).
mustInclude(rmfi, 'blockedPersisted', 'blocked_missing_* must persist a request row')
mustInclude(rmfi, "status: 'blocked_missing_poa'", 'missing POA persists blocked request')
mustInclude(rmfi, "status: 'blocked_missing_grid_owner_contact'", 'missing contact persists blocked request')
mustInclude(rmfi, "status: 'blocked_missing_manual_mailbox'", 'missing mailbox persists blocked request')
mustInclude(rmfi, "'blocked_missing_poa', 'blocked_missing_grid_owner_contact', 'blocked_missing_manual_mailbox',", 'open-request lookup must reuse persisted blocked rows')

// 2. Request-scoped outbox idempotency key.
mustInclude(rmfi, ':${requestType}:${requestId}`', 'idempotency key must include request type and id')
mustNotInclude(rmfi, 'manual-facility-request:${input.companyId}:${input.siteId}:${gridOwnerId}`', 'legacy site-wide idempotency key must be gone')

// 3. Status sync: queued advance covers needs_review and persisted blockers.
const rmfiSrc = read(rmfi)
const advanceIdx = rmfiSrc.indexOf("status: 'manual_email_queued'")
if (advanceIdx === -1 || !rmfiSrc.slice(advanceIdx, advanceIdx + 1400).includes("'needs_review',")) {
  failures.push('request advance to manual_email_queued must include needs_review rows whose gates now pass')
}

// 4. Truthful queue-time site status (waiting only after actual send).
mustInclude(rmfi, "status: 'manual_email_queued',\n    nextAction: 'Begäran är skapad och e-post skickas strax till nätägaren.'", 'site must show queued, not waiting, before the send')
mustInclude(outbox, "facility_data_status: 'waiting_manual_response'", 'site advances to waiting only when the worker confirms the send')

// 5. delivery_uncertain flags the linked request.
mustInclude(outbox, "dispatch_error_code: 'send_uncertain'", 'stale sending recovery must flag the request')

// 6. Orchestrator waiting detection covers manual lifecycle statuses.
mustInclude(orchestrator, "'manual_email_queued', 'manual_email_sent', 'waiting_manual_response'", 'orchestrator must treat all manual waiting statuses as waiting')

// 7. blocked_missing_manual_mailbox is a first-class blocker.
mustInclude(blockers, 'blocked_missing_manual_mailbox', 'blocker catalog entry')
mustInclude(blockers, 'Manuell e-postbrevlåda saknas', 'Swedish status label')
mustInclude(lookupAutomation, "manual.status === 'blocked_missing_manual_mailbox'", 'automation maps missing mailbox to blocked, not needs_review')

// 8. Facility-only replies: grid area may merge from site context.
mustInclude(parser, 'effectiveGridAreaCode', 'parser must merge grid area from site context')
mustInclude(parser, 'effectiveConfidence', 'confidence must account for site-context grid area')

// 9. Work queue shows manual lifecycle + blocked statuses.
mustInclude(workQueue, "'manual_email_queued'", 'work queue includes manual email lifecycle')
mustInclude(workQueue, "'blocked_missing_manual_mailbox'", 'work queue includes persisted configuration blockers')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-facility-missing-path-hardening-regression: all checks passed')
