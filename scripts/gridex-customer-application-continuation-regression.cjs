#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/"/g, "'")
const exists = (file) => fs.existsSync(path.join(root, file))
let failures = 0
function expect(condition, message) {
  if (!condition) {
    failures += 1
    console.error(`FAIL: ${message}`)
  } else console.log(`OK: ${message}`)
}

// customerApplications.ts is intentionally only a bounded public facade after
// the production-file split. Regress against the concrete owners instead of
// relying on stale strings in the facade.
const intakeFacade = read('lib/website/customerApplications.ts')
const intakeProcess = read('lib/website/customerApplicationProcess.ts')
const continuation = read('lib/website/customerApplicationRepair.ts')
const communication = read('lib/website/customerApplicationCommunication.ts')
const intake = `${intakeFacade}\n${intakeProcess}\n${continuation}\n${communication}`
const workflow = read('lib/website/applicationWorkflow.ts')
const worker = read('lib/customer-operations/automation.ts')
const migration = read('supabase/migrations/20260724210000_customer_application_continuation_orchestrator.sql')
const reconciliation = read('lib/website/customerApplicationReconciliation.ts')
const cron = read('app/api/internal/customer-operations/cron/route.ts')
const emailEvents = read('lib/email/emailEvents.ts')
const emailTemplates = read('lib/email/emailTemplates.ts')
const developerDocs = read('app/developers/customer-portal-api/page.tsx')
const legacyDocs = read('docs/external-website-api-integration-guide.md')
const openapi = fs.readFileSync(path.join(root, 'docs/openapi/website-integration-v1.json'), 'utf8')
const lifecycle = read('lib/customer-notifications/notificationOrchestrator.ts')

expect(migration.includes("'customer_application_continuation','queued'"), 'atomic commit creates the canonical continuation job')
expect(migration.includes('drop function if exists public.gridex_commit_customer_application_provisioning('), 'migration drops the prior OUT-row signature before changing the return type')
expect(migration.includes("'workflow_committed','completed'") && migration.includes("'external_automation_queued','completed'"), 'provisioning saga records commit and queued continuation')
expect(migration.includes('for update skip locked') || read('supabase/migrations/20260618110000_customer_operation_automation_jobs.sql').includes('for update skip locked'), 'canonical job claim is atomic')
expect(migration.includes('customer_application_workflow_events_idempotency_uidx'), 'workflow transitions have a unique idempotency identity')
expect(migration.includes('if exists (') && migration.includes('idempotency_key=v_key'), 'repeated workflow transitions do not increment state twice')
expect(migration.includes("'waiting_for_customer_data_response'"), 'Z01/Z02 wait has a non-replayable workflow state')
expect(migration.includes('valid_to is null or valid_to>=current_date') && !migration.includes('valid_until'), 'continuation commit validates the canonical POA validity columns')

const commitIndex = intakeProcess.indexOf("commitApplicationProvisioning({")
const continuationReturnIndex = intakeProcess.indexOf('if (workflow.continuationJobId)', commitIndex)
expect(commitIndex > -1 && continuationReturnIndex > commitIndex, 'API commits before handing off to continuation')
expect(
  continuation.includes('export async function continueWebsiteCustomerApplication') &&
    continuation.includes('dispatchInitialWebsiteApplicationEmails({') &&
    !intakeProcess.includes('dispatchInitialWebsiteApplicationEmails({'),
  'initial e-mail dispatch lives in the durable continuation worker',
)
expect(intakeProcess.includes('customer_application_continuation_not_ready'), 'API fails closed when the continuation migration is missing')
expect(!intakeProcess.includes('const gridOwnerRequestMayBeCreated ='), 'old inline grid-owner continuation path is removed')
expect(!intakeProcess.includes('ensureSupplierSwitchForReadyCustomer'), 'old inline supplier-switch continuation path is removed')
expect(/for \(const eventKey of events\)/.test(communication), 'initial legal e-mails are queued sequentially')
expect(!/Promise\.all\(\s*events\.map/.test(communication), 'initial legal e-mails are not queued in parallel')

expect(worker.includes("case 'customer_application_continuation':"), 'customer-operation worker executes continuation jobs')
expect(worker.includes("['customer_application_continuation', 'dispatch_lifecycle_notification'].includes(job.job_type)"), 'continuation and notification jobs bypass stale site-snapshot rejection until the selected downstream step')
expect(workflow.includes("'waiting_for_customer_data_response'"), 'TypeScript workflow contract matches SQL wait state')

expect(reconciliation.includes('REPLAYABLE_STATES') && reconciliation.includes("'canonical_data_committed'"), 'reconciliation scans stalled active transitions')
expect(!reconciliation.includes("'waiting_for_customer_data_response'"), 'reconciliation does not replay legitimate Z02/ACK waiting')
expect(cron.includes('reconcileCustomerApplicationContinuationJobs'), 'customer-operation cron runs continuation reconciliation')

expect(emailEvents.includes('preserved: DEFAULT_EMAIL_EVENT_RULES.length - missingRows.length'), 'event-rule seeding preserves existing tenant configuration')
expect(emailTemplates.includes('preserved: DEFAULT_EMAIL_TEMPLATES.length - missingRows.length'), 'template seeding preserves existing tenant customization')
expect(lifecycle.includes("'supplier_switch.requested'") && lifecycle.includes("'switch.started'"), 'supplier-switch start is mapped to customer notification')
expect(lifecycle.includes("'supplier_switch.confirmed'") && lifecycle.includes("'switch.confirmed'"), 'supplier-switch confirmation is mapped to customer notification')
expect(lifecycle.includes("'supply_period.activated'") && lifecycle.includes("'customer.welcome_active'"), 'active supply is mapped to the welcome notification')
expect(migration.includes('customer_operation_jobs_lifecycle_notification_uidx'), 'lifecycle notification jobs have permanent idempotency')
expect(lifecycle.includes('enqueueCustomerLifecycleNotification') && lifecycle.includes("job_type: 'dispatch_lifecycle_notification'"), 'lifecycle mail creation is protected by a durable queue job')
expect(worker.includes("case 'dispatch_lifecycle_notification':") && worker.includes('notifyCustomerForLifecycleEvent'), 'customer-operation worker dispatches lifecycle notifications durably')
expect(read('lib/customers/customerOperationEvents.ts').includes('enqueueCustomerLifecycleNotification'), 'customer operation events enqueue lifecycle notifications')
expect(read('lib/ediel/flows/inboundBusinessStateMachine.ts').includes('enqueueCustomerLifecycleNotification'), 'Ediel business outcomes enqueue lifecycle notifications')
expect(continuation.includes('power_of_attorney_required_notification_not_queued'), 'missing POA notification creation fails the continuation job for retry')
expect(exists('app/admin/website-applications/[id]/page.tsx') && read('app/admin/website-applications/[id]/page.tsx').includes('Workflowhändelser'), 'admin application view exposes workflow transitions and jobs')
expect(read('app/admin/website-applications/actions.ts').includes('requeueWebsiteApplicationContinuationAction'), 'admin can safely requeue the canonical continuation row')

expect(
  developerDocs.includes('powerOfAttorney') &&
    developerDocs.includes('facility_information_lookup') &&
    developerDocs.includes('textVersionId'),
  'canonical developer guide documents structured externally-sendable POA',
)
expect(
  developerDocs.includes('/website/customer-applications/APP-2026-000123') &&
    developerDocs.includes('application_number') &&
    developerDocs.includes('Status and lifecycle'),
  'canonical developer guide documents the application status endpoint',
)
expect(
  legacyDocs.includes('/developers/customer-portal-api') &&
    !legacyDocs.includes('tenant_email_outbox'),
  'legacy website guide delegates details to the canonical public guide without internal queue terminology',
)
expect(openapi.includes('CustomerApplicationStatus') && openapi.includes('/api/v1/website/customer-applications/{application_number}'), 'OpenAPI exposes the organization-scoped status endpoint')
expect(exists('app/api/v1/website/customer-applications/[applicationId]/route.ts') && read('lib/website/customerApplicationStatus.ts').includes(".eq('application_number', input.applicationNumber)"), 'status endpoint route exists')
expect(exists('lib/website/customerApplicationWorkflowBridge.ts'), 'downstream facility/Ediel outcomes correlate back to the original workflow')

if (failures) {
  console.error(`\n${failures} continuation regression check(s) failed.`)
  process.exit(1)
}
console.log('\nCustomer application continuation regression passed.')
