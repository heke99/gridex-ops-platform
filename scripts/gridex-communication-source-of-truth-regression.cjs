/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: exactly ONE communication source of truth (communication_logs +
// tenant_email_outbox) — no orphan write paths, truthful queued-vs-sent API
// semantics, and no "SMTP skickad" claim without actual dispatch proof.
const fs = require('fs')

// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
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
const websitePersistence = 'lib/website/customerApplicationPersistence.ts'
const websiteRepair = 'lib/website/customerApplicationRepair.ts'
const websiteLegal = 'lib/website/customerApplicationLegal.ts'
const workflow = 'lib/customer-operations/customerCardWorkflow.ts'

// 1. No orphan customer_communications write path: confirmation mail flows
//    through triggerEmailEvent -> communication_logs like every other mail.
mustInclude(confirmation, 'triggerEmailEvent', 'confirmation must use the canonical pipeline')
mustNotInclude(confirmation, "from('customer_communications')", 'orphan customer_communications write removed')
mustInclude(confirmation, 'communication_logs', 'source of truth documented in the action result')

// 2. API handoff truth: accepted response is pending; worker results derive
//    queued-vs-sent from communication_logs after durable continuation.
mustInclude(websiteLegal, 'export function emailDispatchStatus', 'per-event dispatch status comes from communication_logs')
mustInclude(websiteCommunication, "dispatch_status: emailDispatchStatus(result)", 'each event result exposes dispatch_status')
mustInclude(websiteCommunication, "source_of_truth: 'communication_logs'", 'response declares the source of truth')
mustInclude(websitePersistence, 'queued: [],', 'accepted response does not claim that worker e-mails are already queued')
mustInclude(websitePersistence, 'sent: [],', 'accepted response does not claim provider-confirmed delivery')
mustInclude(websitePersistence, 'pending: true', 'accepted response declares asynchronous communication pending')
mustInclude(websiteRepair, 'initial_customer_communication_failed:', 'failed communication-log/outbox creation fails the durable continuation for retry')

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
