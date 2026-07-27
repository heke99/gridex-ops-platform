#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: website customer application idempotency, payload validation and
// supplier-switch resume semantics.
const fs = require('fs')
const path = require('path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// assertions below are structural, so normalize quotes for .ts/.tsx haystacks
// to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
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
const adminActions = read('app/admin/customers/[id]/actions.ts')
const migration = read('supabase/migrations/20260710110000_website_application_idempotency_and_supplier_resume.sql')
const docs = read('docs/gridex-customer-portal-api.md')
const docsPage = read('app/developers/customer-portal-api/page.tsx')

expect(intake.includes("import { createHash } from 'node:crypto'"), 'normalized payload is SHA-256 hashed')
expect(intake.includes("code: 'idempotency_key_required'"), 'Idempotency-Key is mandatory')
expect(intake.includes("code: 'idempotency_key_invalid'"), 'Idempotency-Key format is validated')
expect(intake.includes("code: 'idempotency_key_payload_mismatch'"), 'same key with a different payload is rejected')
expect(intake.includes('storedApplicationPayloadHash'), 'legacy rows without payload_hash are compared using their stored normalized payload')
expect(intake.includes("code: 'idempotency_in_progress'"), 'concurrent replay returns an in-progress conflict')
expect(intake.includes("status: 'processing'"), 'idempotency row is reserved before side effects')
expect(intake.includes('reserveWebsiteApplicationIdempotency'), 'reservation helper is part of the intake path')
expect(!/duplicateIdempotencyKey\([\s\S]{0,900}\.update\([\s\S]{0,500}\.eq\('idempotency_key'/.test(intake), 'duplicate-key loser never overwrites the winner')
expect(intake.includes('payload_hash'), 'application row persists payload_hash')
expect(intake.includes('REPLAYABLE_COMMITTED_STATUSES'), 'committed replay statuses are centrally classified')
expect(intake.includes('COMMITTED_METERING_REQUIRED_STATUSES'), 'replay validates status-specific durable resources')
expect(intake.includes('existingIdempotent.warnings ?? []'), 'replay preserves stored warnings')
expect(intake.includes('communication: {') && intake.includes('processingResponsePayload'), 'communication snapshot is stored in replay payload')
expect(intake.includes("code: 'duplicate_application'"), 'identical committed application under a new key is rejected')
expect(intake.includes("'application_business_in_progress'"), 'same business event already processing returns a distinct in-progress conflict')
expect(intake.includes("'application_business_conflict'"), 'same customer/site/offer/start business event cannot create a parallel application')
expect(intake.includes('applicationBusinessKeyHash') && intake.includes('business_key_hash'), 'business duplicate policy uses a stable indexed key')

expect(intake.includes("code: 'requested_start_mode_invalid'"), 'requested_start_mode is enum validated')
expect(intake.includes("code: 'date_invalid'"), 'calendar dates are validated')
expect(intake.includes("code: 'timestamp_invalid'"), 'POA acceptedAt timestamp is validated')
expect(intake.includes("code: 'unknown_field'"), 'unknown top-level and nested business fields are rejected')
expect(intake.includes('current_supplier_ediel_id'), 'current supplier Ediel id is accepted and persisted')
expect(intake.includes('continuation_job_id') && intake.includes("next_step: 'automatic_processing'"), 'response hands downstream switch readiness to the durable continuation worker')
expect(orchestration.includes("'current_supplier_missing'") && orchestration.includes('currentSupplierResponseReviewBlockers'), 'missing current supplier is a concrete continuation blocker')

expect(orchestration.includes('shouldClearManagedBusinessBlock'), 'resolved business blocker is identified')
expect(orchestration.includes('lifecycle_blocked = false'), 'managed lifecycle blocker is cleared when resolved')
expect(orchestration.includes("eventType: 'supplier_switch.unblocked'"), 'unblock operation event is emitted')
expect(orchestration.includes('unrelatedLifecycleBlock'), 'unrelated lifecycle/legal blocks are preserved')
expect(orchestration.includes('shouldBlockForBusinessReview && !unrelatedLifecycleBlock'), 'business review never overwrites an unrelated lifecycle block source')
expect(orchestration.includes('currentSupplierResponseReviewBlockers') && orchestration.includes('current_supplier_binding_period') && orchestration.includes('current_supplier_termination_fee'), 'supplier contract risks remain dispatch blockers during reconcile')
expect(orchestration.includes('reconcileSupplierSwitchAfterCustomerDataChange'), 'shared data-change reconcile helper exists')
expect(adminActions.includes("source: 'customer_site_saved'"), 'site save triggers switch reconcile')
expect(adminActions.includes("source: 'metering_point_saved'"), 'metering point save triggers switch reconcile')
expect(adminActions.includes("source: 'current_supplier_response_registered'"), 'supplier response triggers switch reconcile')
expect(adminActions.includes("source: 'power_of_attorney_signed'"), 'signed POA triggers switch reconcile')
expect(adminActions.includes("source: 'power_of_attorney_document_signed'"), 'signed uploaded POA document triggers switch reconcile')

expect(migration.includes("'processing'"), 'database status constraint allows processing reservation')
expect(migration.includes('current_supplier_ediel_id'), 'database stores current supplier Ediel id')
expect(migration.includes('idx_website_customer_applications_payload_hash'), 'payload-hash lookup is indexed')
expect(migration.includes('idx_website_customer_applications_business_key_hash'), 'business-key duplicate lookup is indexed')
expect(migration.includes('website_customer_applications_company_business_event_uidx'), 'database enforces one active business event even under concurrent idempotency keys')

for (const source of [docs, docsPage]) {
  expect(source.includes('idempotency_key_payload_mismatch'), 'API documentation covers payload mismatch')
  expect(source.includes('idempotency_in_progress'), 'API documentation covers concurrent in-progress replay')
  expect(source.includes('duplicate_application'), 'API documentation covers duplicate application policy')
  expect(source.includes('application_business_in_progress'), 'API documentation covers an already-processing business event')
  expect(source.includes('application_business_conflict'), 'API documentation covers business-level duplicate policy')
  expect(source.includes('current_supplier_ediel_id'), 'API documentation covers current supplier fields')
  expect(source.includes('automatic_processing') && source.includes('customer_application_continuation'), 'API documentation explains durable downstream processing')
}

if (failures > 0) {
  console.error(`\n${failures} regression assertion(s) failed.`)
  process.exit(1)
}
console.log('\nWebsite application idempotency hardening regression passed.')
