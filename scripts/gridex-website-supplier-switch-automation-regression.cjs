#!/usr/bin/env node
// Regression: automatic supplier switch orchestration after website intake.
//
// Covers:
//  1. Complete-facility website application creates supplier_switch_requests
//     and enqueues the canonical start_supplier_switch job.
//  2. Communication stays strict (no confirmation/cooling-off when
//     can_send_agreement_confirmation=false).
//  3. Missing-facility does not create supplier switch before facility data;
//     completion reuses the same orchestration helper.
//  4. Missing GRIDEX_AUTOMATION_USER_ID is a non-retryable configuration
//     blocker (missing_automation_user), not a retried technical error.
//  5. Missing route produces route-specific blockers, not generic
//     technical_error; send-window-only blocks reschedule automatically.
//  6. Idempotency: open-switch reuse + automation_key/open-site unique indexes
//     + active-job unique key.
//  7. Schema correctness: ediel_messages.site_id/raw_payload/parsed_payload,
//     customer_info_requests.site_id (never customer_site_id / payload).
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
let failures = 0

function expect(condition, message) {
  if (!condition) {
    failures += 1
    console.error(`FAIL: ${message}`)
  } else {
    console.log(`OK: ${message}`)
  }
}

const intake = read('lib/website/customerApplications.ts')
const orchestration = read('lib/customer-operations/supplierSwitchOrchestration.ts')
const automation = read('lib/customer-operations/automation.ts')
const automationConfig = read('lib/customer-operations/automationConfig.ts')
const blockers = read('lib/customer-operations/blockers.ts')
const nextStepEngine = read('lib/customer-operations/customerProcessNextStepEngine.ts')
const facilityOrchestrator = read('lib/customer-operations/facilityResponseOrchestrator.ts')
const operationsDb = read('lib/operations/db.ts')
const cronRoute = read('app/api/internal/customer-operations/cron/route.ts')
const idempotencyMigration = read('supabase/migrations/20260709150000_supplier_switch_automation_key_idempotency.sql')

// 1. Complete-facility website intake starts switch orchestration -------------
expect(
  intake.includes('ensureSupplierSwitchForReadyCustomer'),
  'website intake calls the supplier switch orchestration helper'
)
expect(
  /applicationStatus === 'ready_for_switch' &&\s*readiness\.canStartSwitch === true/.test(intake),
  'orchestration is gated on ready_for_switch + can_start_switch'
)
expect(
  /meteringPoint\?\.id &&\s*contract\?\.id &&\s*powerOfAttorneyId &&\s*supplierSwitchStartDate/.test(intake),
  'orchestration requires metering point, contract, signed POA and a requested start/move-in date'
)
expect(
  /const siteMoveInDate = clean\(body\.site\?\.move_in_date\)/.test(intake) &&
    /readiness\.requestedStartDate \?\? siteMoveInDate/.test(intake),
  'requested start date falls back to the site move-in date'
)
expect(
  intake.includes('supplier_switch_request_id') && intake.includes('supplier_switch_status'),
  'response_payload exposes supplier_switch_request_id and status additively'
)
expect(
  /!facilityMissing/.test(intake.split('ensureSupplierSwitchForReadyCustomer')[1] ?? '') ||
    /!facilityMissing[\s\S]{0,400}ensureSupplierSwitchForReadyCustomer/.test(intake),
  'website intake never starts switch orchestration when facility is missing'
)

// 2. Orchestration helper contract --------------------------------------------
expect(
  orchestration.includes("automationOrigin: 'website_customer_application'"),
  'switch request automation_origin = website_customer_application'
)
expect(
  orchestration.includes('website_application_${applicationId}_supplier_switch'),
  'switch request automation_key = website_application_<application_id>_supplier_switch'
)
expect(
  orchestration.includes('findOpenSupplierSwitchRequestForSite') &&
    /reusedExisting: true/.test(orchestration),
  'existing open switch requests are reused instead of duplicated'
)
expect(
  /facility_or_metering_point_missing/.test(orchestration),
  'helper refuses to create a switch without facility/metering identity'
)
expect(
  orchestration.includes('SUPPLIER_SWITCH_CREATION_BLOCKER_CODES') &&
    !/SUPPLIER_SWITCH_CREATION_BLOCKER_CODES[\s\S]{0,500}'current_supplier_missing'/.test(orchestration),
  'current_supplier_missing is not a switch-request creation blocker'
)
expect(
  orchestration.includes('splitReadinessIssuesForSwitchRequestCreation') &&
    /reviewBlockers/.test(orchestration) &&
    /creationBlockers/.test(orchestration),
  'readiness issues are split into creation blockers and review/send blockers'
)
expect(
  !/if \(!readiness\.isReady\) \{[\s\S]{0,500}request: null/.test(orchestration),
  'readiness.isReady is not used as a blanket gate before supplier_switch_requests creation'
)
expect(
  /initialStatus: reviewBlockers\.length > 0 \? 'manual_followup_required' : 'queued'/.test(orchestration) &&
    /businessBlockers: reviewBlockers/.test(orchestration) &&
    /lifecycleBlockSource: reviewBlockers\[0\]\?\.code/.test(orchestration),
  'review blockers create manual_followup_required switch requests with lifecycle blocker metadata'
)
expect(
  orchestration.includes('if (ensured.blockers.length > 0) {') &&
    /if \(ensured\.blockers\.length > 0\) \{[\s\S]{0,2000}jobId: null/.test(orchestration) &&
    /blockedBeforeDispatch: true/.test(orchestration),
  'business-blocked switch requests are created but do not enqueue start_supplier_switch/EDIEL dispatch'
)
expect(
  orchestration.includes("eventType: 'supplier_switch.request_created'"),
  'supplier_switch.request_created operation event is emitted'
)
expect(
  /application_id: clean\(context\.applicationId\)/.test(orchestration) &&
    /external_customer_id: clean\(context\.externalCustomerId\)/.test(orchestration) &&
    /requested_start_mode/.test(orchestration) &&
    /bidding_zone_code/.test(orchestration) &&
    /grid_owner_id/.test(orchestration),
  'switch request metadata carries application/external id, start mode/date, facility and grid context'
)
expect(
  /supplier_switch_request_id: ensured\.request\.id/.test(orchestration) &&
    /application_id: input\.applicationId/.test(orchestration) &&
    /contract_id: clean\(context\.contractId\)/.test(orchestration) &&
    /source,\s*idempotency_context: `\$\{input\.applicationId\}:\$\{ensured\.request\.id\}`/.test(orchestration),
  'start_supplier_switch job payload includes application_id, supplier_switch_request_id, contract_id and application+switch idempotency context'
)

// 3. Canonical job type + payload context -------------------------------------
expect(
  automation.includes("jobType: 'start_supplier_switch'") &&
    automation.includes('supplier-switch:${normalized.customerId}:${normalized.siteId}'),
  'canonical start_supplier_switch job with site-scoped active idempotency key'
)
expect(
  /payloadContext\?: JsonRecord \| null/.test(automation) &&
    /\.\.\.\(input\.payloadContext \?\? \{\}\)/.test(automation),
  'enqueueSupplierSwitchAutomation merges business payload context into the job payload'
)
expect(
  /clean\(jobPayload\.requested_start_date\) \?\? site\.move_in_date/.test(automation),
  'switch job creation honors the requested start date from the job payload'
)

// 4. Communication stays strict ------------------------------------------------
expect(
  /const canDispatchFinalAgreementMail = Boolean\(\s*readiness\.canSendAgreementConfirmation === true &&/.test(intake),
  'final agreement mail still requires can_send_agreement_confirmation=true'
)
expect(
  /canDispatchFinalAgreementMail \? \['contract\.confirmation_sent', 'contract\.cooling_off_sent'\] : \[\]/.test(intake),
  'confirmation/cooling-off events remain gated behind canDispatchFinalAgreementMail'
)

// 5. Missing-facility path -------------------------------------------------------
expect(
  /const gridOwnerRequestMayBeCreated = readiness\.canRequestGridOwnerInformation && !facilityMissing/.test(intake),
  'missing facility keeps the manual grid-owner information path (no Ediel request)'
)
expect(
  /facilityIdentity\.siteExists && !facilityIdentity\.facilityReady/.test(automation) &&
    automation.includes("eventType: 'supplier_switch.blocked_missing_facility'"),
  'enqueueSupplierSwitchAutomation still redirects missing facility to the manual request path'
)
expect(
  nextStepEngine.includes('ensureSupplierSwitchRequestForReadySite'),
  'missing-facility completion reuses the shared switch-creation core'
)
expect(
  nextStepEngine.includes("automationKey: `facility_data_received:${input.companyId}:${input.site.id}`"),
  'facility-completion switch keeps its canonical automation key'
)
expect(
  facilityOrchestrator.includes('completeFacilityLookupAndRunNextSteps') &&
    facilityOrchestrator.includes('evaluateAndRunNextCustomerStep'),
  'facility response orchestrator entrypoints are unchanged'
)

// 6. Non-retryable GRIDEX_AUTOMATION_USER_ID configuration blocker ---------------
expect(
  /resolveAutomationActorId\(value\)/.test(automation),
  'automation actor resolution goes through the typed config resolver'
)
expect(
  /if \(isAutomationConfigurationError\(error\)\) \{/.test(automation) &&
    automation.indexOf('isAutomationConfigurationError(error)') <
      automation.indexOf('const terminal = job.attempts >= job.max_attempts'),
  'configuration errors short-circuit BEFORE the generic retry logic (no burned attempts)'
)
expect(
  automation.includes("eventType: 'automation.configuration_missing'"),
  'automation.configuration_missing operation event is emitted'
)
expect(
  /missing_automation_user: \{/.test(blockers) &&
    /error_class: "configuration_error"/.test(blockers) &&
    /Configure GRIDEX_AUTOMATION_USER_ID for automatic EDIEL\/supplier switch operations/.test(blockers),
  'missing_automation_user blocker registered with error_class configuration_error'
)
expect(
  /readonly retryable = false as const/.test(automationConfig) &&
    /configure_GRIDEX_AUTOMATION_USER_ID/.test(automationConfig),
  'typed error carries retryable=false and required_admin_action configure_GRIDEX_AUTOMATION_USER_ID'
)
expect(
  /auth\.users/.test(automationConfig) && /getUserById/.test(automationConfig),
  'automation user is documented/validated against auth.users (public.profiles does not exist)'
)
expect(
  cronRoute.includes('validateAutomationUserConfig'),
  'customer-operations cron validates the automation user config at runtime'
)
expect(
  nextStepEngine.includes('resolveAutomationActorId') &&
    !/actorUserId = input\.actorUserId \?\? 'system'/.test(nextStepEngine),
  "next-step engine resolves the automation actor instead of the literal 'system'"
)

// 7. Route/preflight blockers -----------------------------------------------------
expect(
  automation.includes('classifySupplierSwitchDispatch'),
  'failed dispatch is classified into exact blockers'
)
expect(
  automation.includes("eventType: 'supplier_switch.route_blocked'") &&
    /route_resolution_status: 'blocked'/.test(automation),
  'route/config family produces supplier_switch.route_blocked with route_resolution_status=blocked'
)
expect(
  /routeIssueCodeToCustomerBlocker/.test(automation),
  'route engine codes map to canonical customer blockers (route_profile_missing etc.)'
)
expect(
  /scheduleWindowOnly && !classification\.routeBlocked/.test(automation) &&
    /status: 'queued',\s*runAfter: resumeAt/.test(automation),
  'send-window-only blocks reschedule the job automatically instead of needs_review'
)
expect(
  automation.includes('persistSupplierSwitchBlockerMetadata'),
  'dispatch blockers are persisted on supplier_switch_requests.metadata for queue visibility'
)

// 8. Idempotency ---------------------------------------------------------------------
expect(
  idempotencyMigration.includes('supplier_switch_requests_open_automation_key_uidx') &&
    /where automation_key is not null/.test(idempotencyMigration),
  'migration adds partial unique index on (company_id, automation_key) for open switches'
)
expect(
  /raise notice/.test(idempotencyMigration) && /lock_timeout/.test(idempotencyMigration),
  'migration is guarded (duplicate NOTICE skip) and uses lock/statement timeouts'
)
expect(
  /OPEN_SUPPLIER_SWITCH_STATUSES/.test(operationsDb) &&
    /getSupplierSwitchRequestByAutomationKey/.test(operationsDb),
  '23505 automation-key recovery resolves back to the open switch request'
)
expect(
  /externalReference\?: string \| null;\s*metadata\?: Record<string, unknown> \| null;/.test(operationsDb),
  'createSupplierSwitchRequest accepts external_reference and metadata'
)
expect(
  /initialStatus\?: SupplierSwitchRequestStatus/.test(operationsDb) &&
    /businessBlockers\?: Array<\{ code: string; message: string \}>/.test(operationsDb) &&
    /lifecycleBlockSource\?: string \| null/.test(operationsDb),
  'createSupplierSwitchRequest accepts status and business blocker fields'
)
expect(
  /status: initialStatus/.test(operationsDb) &&
    /lifecycle_blocked: params\.lifecycleBlocked \?\? Boolean\(primaryBusinessBlocker\)/.test(operationsDb) &&
    /lifecycle_block_source: params\.lifecycleBlockSource \?\? primaryBusinessBlocker\?\.code/.test(operationsDb),
  'blocked switch requests are persisted with manual status and lifecycle block source for company_switch_queue_v visibility'
)
expect(
  /supplier_switch_blockers: businessBlockers/.test(operationsDb) &&
    /pending_review_reason: primaryBusinessBlocker\?\.code/.test(operationsDb) &&
    /businessBlockers,/.test(operationsDb),
  'business blockers are stored in metadata and validation_snapshot'
)

// 9. Schema correctness (Error 7) ---------------------------------------------------
expect(
  !/ediel_messages'\)[\s\S]{0,400}customer_site_id/.test(orchestration) &&
    !/from\('ediel_messages'\)[\s\S]{0,200}\.eq\('customer_site_id'/.test(automation),
  'no ediel_messages queries use customer_site_id (column does not exist)'
)
expect(
  !/ediel_messages[\s\S]{0,200}\.select\([^)]*'payload'/.test(automation),
  'no ediel_messages queries select a payload column (raw_payload/parsed_payload are canonical)'
)
expect(
  /from\('customer_info_requests'\)[\s\S]{0,300}\.eq\('site_id'/.test(automation),
  'customer_info_requests queries use site_id (customer_site_id does not exist)'
)

process.exit(failures === 0 ? 0 : 1)
