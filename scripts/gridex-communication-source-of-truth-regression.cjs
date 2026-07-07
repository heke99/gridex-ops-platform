/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: exactly ONE communication source of truth (communication_logs +
// tenant_email_outbox) — no orphan write paths, truthful queued-vs-sent API
// semantics, and no "SMTP skickad" claim without actual dispatch proof.
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

const confirmation = 'lib/operations/businessActions/sendCustomerConfirmation.ts'
const website = 'lib/website/customerApplications.ts'
const workflow = 'lib/customer-operations/customerCardWorkflow.ts'

// 1. No orphan customer_communications write path: confirmation mail flows
//    through triggerEmailEvent -> communication_logs like every other mail.
mustInclude(confirmation, 'triggerEmailEvent', 'confirmation must use the canonical pipeline')
mustNotInclude(confirmation, "from('customer_communications')", 'orphan customer_communications write removed')
mustInclude(confirmation, 'communication_logs', 'source of truth documented in the action result')

// 2. API queued-vs-sent truth for website intake communication block.
mustInclude(website, 'function emailDispatchStatus', 'per-event dispatch status from communication_logs')
mustInclude(website, "dispatch_status: emailDispatchStatus(result)", 'each event result exposes dispatch_status')
mustInclude(website, "source_of_truth: 'communication_logs'", 'response declares the source of truth')
mustInclude(website, "queued: email ? communicationStatusOf(['queued'])", 'queued events listed separately')
mustInclude(website, "sent: email ? communicationStatusOf(['sent'])", 'sent only when provider-confirmed')

// 3. Workflow step: EDIEL SMTP send claims require dispatch proof.
mustInclude(workflow, 'label: "EDIEL-utskick (SMTP)"', 'SMTP step is channel-specific')
mustNotInclude(workflow, 'facilityDispatchSent || isWaiting ? "done"', 'waiting status must never mark the send as done')
mustInclude(workflow, 'status: facilityDispatchSent ? "done" : facilityDispatchQueued ? "current" : isWaiting ? "waiting" : "not_started"', 'send step truth table')

// 4. Legal *_sent domain events still only fire after actual send.
mustInclude('lib/email/emailDomainEvents.ts', 'emitCommunicationSentDomainEvents', 'sent domain events stay post-send')
mustInclude(website, 'actual communication_log is marked sent', 'website intake keeps post-send event contract')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-communication-source-of-truth-regression: all checks passed')
