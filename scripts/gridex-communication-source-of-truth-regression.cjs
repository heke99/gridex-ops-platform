/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: exactly ONE communication source of truth (communication_logs +
// tenant_email_outbox) — no orphan write paths, truthful queued-vs-sent API
// semantics, and no "SMTP skickad" claim without actual dispatch proof.
const fs = require('fs')

function read(file) {
  const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}
function mustNotInclude(file, needle, why) {
  if (read(file).includes(needle)) failures.push(`Forbidden "${needle}" in ${file} (${why})`)
}

const confirmation = 'lib/operations/businessActions/sendCustomerConfirmation.ts'
const websiteCommunication = 'lib/website/customerApplicationCommunication.ts'
const websiteBarrel = 'lib/website/customerApplications.ts'
const workflow = 'lib/customer-operations/customerCardWorkflow.ts'

// 1. No orphan customer_communications write path: confirmation mail flows
// through triggerEmailEvent -> communication_logs like every other mail.
mustInclude(confirmation, 'triggerEmailEvent', 'confirmation must use the canonical pipeline')
mustNotInclude(confirmation, "from('customer_communications')", 'orphan customer_communications write removed')
mustInclude(confirmation, 'communication_logs', 'source of truth documented in the action result')

// 2. The old monolith is now an intentional barrel; communication semantics live
// in the extracted communication module and remain derived from communication_logs.
mustInclude(websiteBarrel, './customerApplicationProcess', 'website barrel delegates processing to the bounded module')
mustInclude(websiteCommunication, 'emailDispatchStatus', 'per-event dispatch status derives from canonical communication evidence')
mustInclude(websiteCommunication, "dispatch_status: emailDispatchStatus(result)", 'each event result exposes dispatch_status')
mustInclude(websiteCommunication, "source_of_truth: 'communication_logs'", 'response declares the source of truth')
mustInclude(websiteCommunication, "pending: items.some((item) => item.status === 'queued')", 'pending is true only for actually queued communication')
mustInclude(websiteCommunication, "queued: items.filter((item) => item.status === 'queued')", 'queued results are derived from dispatch evidence')
mustInclude(websiteCommunication, "sent: items.filter((item) => item.status === 'sent')", 'sent results require sent dispatch evidence')
mustInclude(websiteCommunication, "failed: items.filter((item) => item.status === 'failed')", 'failed dispatches remain explicit and retryable')
mustInclude(websiteCommunication, '.catch((error) => [', 'communication trigger failures are captured as durable failed outcomes')

// 3. Workflow step: EDIEL SMTP send claims require dispatch proof.
mustInclude(workflow, "label: 'EDIEL-utskick (SMTP)'", 'SMTP step is channel-specific')
mustNotInclude(workflow, "facilityDispatchSent || isWaiting ? 'done'", 'waiting status must never mark the send as done')
mustInclude(workflow, "status: facilityDispatchSent ? 'done' : facilityDispatchQueued ? 'current' : isWaiting ? 'waiting' : 'not_started'", 'send step truth table')

// 4. Legal *_sent domain events still only fire after actual send.
mustInclude('lib/email/emailDomainEvents.ts', 'emitCommunicationSentDomainEvents', 'sent domain events stay post-send')
mustInclude('lib/email/emailOutbox.ts', 'const sentLog = await markCommunicationSent(', 'outbox marks the communication log sent before emitting domain events')
mustInclude('lib/email/emailOutbox.ts', "emitCommunicationSentDomainEvents(sentLog, { source: 'email_outbox' })", 'outbox emits legal sent events only from the provider-confirmed sent log')
mustInclude('lib/email/resendWebhookEvents.ts', "if (eventType === 'email.sent')", 'provider webhook emits sent events only for an explicit email.sent event')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-communication-source-of-truth-regression: all checks passed')
