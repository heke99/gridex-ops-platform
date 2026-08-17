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
const process = 'lib/website/customerApplicationProcess.ts'
const communication = 'lib/website/customerApplicationCommunication.ts'
const continuation = 'lib/website/customerApplicationRepair.ts'
const workflow = 'lib/customer-operations/customerCardWorkflow.ts'
const barrel = 'lib/website/customerApplications.ts'

// 1. No orphan customer_communications write path: confirmation mail flows
// through triggerEmailEvent -> communication_logs like every other mail.
mustInclude(confirmation, 'triggerEmailEvent', 'confirmation must use the canonical pipeline')
mustNotInclude(confirmation, "from('customer_communications')", 'orphan customer_communications write removed')
mustInclude(confirmation, 'communication_logs', 'source of truth documented in the action result')

// 2. The public barrel must delegate to bounded modules; it must not silently
// reintroduce a second implementation after the customerApplications split.
mustInclude(barrel, './customerApplicationProcess', 'public process entrypoint delegates to the canonical process module')
mustInclude(barrel, './customerApplicationRepair', 'continuation/repair entrypoints delegate to the canonical repair module')

// 3. API handoff truth: the request returns accepted+pending only after the
// durable continuation exists. It explicitly claims no queued/sent e-mail yet.
mustInclude(process, 'continuation_job_id: workflow.continuationJobId', 'accepted response is backed by a durable continuation job')
mustInclude(process, "workflow_state: 'canonical_data_committed'", 'accepted response reports the committed workflow state')
mustInclude(process, 'queued: [],', 'accepted response does not claim worker e-mails are already queued')
mustInclude(process, 'sent: [],', 'accepted response does not claim provider-confirmed delivery')
mustInclude(process, 'pending: true', 'accepted response declares asynchronous communication pending')
mustInclude(process, "source_of_truth: 'communication_logs'", 'accepted response declares the canonical communication source')

// 4. Worker dispatch truth is derived from the canonical trigger result and is
// summarized from communication_logs statuses. A failed initial event aborts
// the durable continuation so the worker can retry instead of claiming success.
mustInclude(communication, 'dispatch_status: emailDispatchStatus(result)', 'each initial event derives dispatch status from canonical communication evidence')
mustInclude(communication, 'communicationStatusSnapshot', 'communication module exposes one canonical status snapshot')
mustInclude(communication, "source_of_truth: 'communication_logs'", 'status snapshot declares communication_logs as source of truth')
mustInclude(communication, "items.filter((item) => item.status === 'queued')", 'queued state is derived from dispatch evidence')
mustInclude(communication, "items.filter((item) => item.status === 'sent')", 'sent state is derived from dispatch evidence')
mustInclude(continuation, 'communicationStatusSnapshot(communication)', 'durable continuation uses the canonical communication snapshot')
mustInclude(continuation, 'initial_customer_communication_failed:', 'failed communication creation fails the durable continuation for retry')

// 5. Workflow step: EDIEL SMTP send claims require dispatch proof.
mustInclude(workflow, "label: 'EDIEL-utskick (SMTP)'", 'SMTP step is channel-specific')
mustNotInclude(workflow, "facilityDispatchSent || isWaiting ? 'done'", 'waiting status must never mark the send as done')
mustInclude(workflow, "status: facilityDispatchSent ? 'done' : facilityDispatchQueued ? 'current' : isWaiting ? 'waiting' : 'not_started'", 'send step truth table')

// 6. Legal *_sent domain events still only fire after actual send.
mustInclude('lib/email/emailDomainEvents.ts', 'emitCommunicationSentDomainEvents', 'sent domain events stay post-send')
mustInclude('lib/email/emailOutbox.ts', 'const sentLog = await markCommunicationSent(', 'outbox marks communication sent before emitting domain events')
mustInclude('lib/email/emailOutbox.ts', "emitCommunicationSentDomainEvents(sentLog, { source: 'email_outbox' })", 'outbox emits legal sent events only from provider-confirmed sent log')
mustInclude('lib/email/resendWebhookEvents.ts', "if (eventType === 'email.sent')", 'provider webhook emits sent events only for explicit email.sent')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-communication-source-of-truth-regression: all checks passed')
