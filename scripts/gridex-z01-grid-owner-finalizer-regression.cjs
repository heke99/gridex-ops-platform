#!/usr/bin/env node
// Regression: PRODAT Z01 grid owner data request finalizer
// Verifies:
// 1. Code does NOT assume grid_owner_data_requests.outbound_request_id
// 2. Relationship between grid_owner_data_requests and outbound_requests is via source_type/source_id
// 3. Finalizer creates outbound_request when GODR has none
// 4. Old stale outbound with different source_id does not block current finalization
// 5. Outbound gets communication_route_id and ediel_route_profile_id
// 6. customer_info_request blocker is cleared when route is ready
// 7. ediel_message is created/prepared
// 8. No direct SMTP send in repair path
// 9. Duplicate pending grid_owner_data_requests are not created repeatedly

const fs = require('fs')
const path = require('path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}

const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const finalizer = read('lib/customer-operations/z01Finalizer.ts')
const infoRequests = read('lib/onboarding/infoRequests.ts')
const automation = read('lib/customer-operations/automation.ts')
const sharedFlow = read('lib/ediel/flows/shared.ts')
const cisTypes = read('lib/cis/types.ts')
const z01Flow = read('lib/ediel/flows/prodatCustomerMasterdata.ts')

// ---- 1. grid_owner_data_requests type does NOT have outbound_request_id ----
// The GridOwnerDataRequestRow type should not declare outbound_request_id as a column
const godrTypeBlock = cisTypes.match(/GridOwnerDataRequestRow\s*=\s*\{[\s\S]*?\}/)?.[0] ?? ''
assert(
  !godrTypeBlock.includes('outbound_request_id'),
  'GridOwnerDataRequestRow type: does NOT declare outbound_request_id column'
)
assert(
  !godrTypeBlock.includes('ediel_message_id'),
  'GridOwnerDataRequestRow type: does NOT declare ediel_message_id column'
)

// ---- 2. Relationship uses sourceType='grid_owner_data_request' + sourceId ----
assert(
  /sourceType.*grid_owner_data_request|'grid_owner_data_request'/.test(sharedFlow),
  'shared.ts: findOrCreateDataRequestOutbound uses sourceType = grid_owner_data_request'
)
assert(
  /sourceId.*dataRequest\.id|source_id.*dataRequest\.id/.test(sharedFlow),
  'shared.ts: outbound sourceId/source_id is set to grid_owner_data_request.id'
)
assert(
  /source_type.*grid_owner_data_request/.test(finalizer),
  'z01Finalizer.ts: findOutboundForGodr queries by source_type = grid_owner_data_request'
)
assert(
  /source_id.*godrId/.test(finalizer),
  'z01Finalizer.ts: findOutboundForGodr queries by source_id = GODR id'
)

// ---- 3. Finalizer uses prepareAndQueueProdatZ01FromDataRequest ----
assert(
  /prepareAndQueueProdatZ01FromDataRequest/.test(finalizer),
  'z01Finalizer.ts: delegates to prepareAndQueueProdatZ01FromDataRequest'
)
assert(
  /finalizeStuckZ01GridOwnerDataRequest/.test(finalizer),
  'z01Finalizer.ts: exports finalizeStuckZ01GridOwnerDataRequest'
)
assert(
  /dryRunZ01Finalizer/.test(finalizer),
  'z01Finalizer.ts: exports dryRunZ01Finalizer'
)

// ---- 4. Old stale outbound with different source_id: handled by findOrCreateDataRequestOutbound ----
// shared.ts reuses existing outbound for same source_id, doesn't look for old ones with different source_id
assert(
  /findOpenOutboundBySource/.test(sharedFlow),
  'shared.ts: uses findOpenOutboundBySource for idempotency'
)

// ---- 5. Outbound gets communication_route_id and ediel_route_profile_id ----
assert(
  /ediel_route_profile_id/.test(z01Flow),
  'prodatCustomerMasterdata.ts: references ediel_route_profile_id (not route_profile_id)'
)
assert(
  /communication_route_id/.test(z01Flow),
  'prodatCustomerMasterdata.ts: references communication_route_id'
)
// Verify the wrong column name is not used in z01 flow
assert(
  !/\.route_profile_id\b/.test(z01Flow.replace(/ediel_route_profile_id/g, '')),
  'prodatCustomerMasterdata.ts: does NOT use bare route_profile_id on outbound rows'
)

// ---- 6. customer_info_request blocker is updated when route is ready ----
assert(
  /outbound_request_id.*z01\.outbound\.id|z01\.outbound\.id.*outbound_request_id/s.test(infoRequests),
  'infoRequests.ts: sets outbound_request_id from z01.outbound.id'
)
assert(
  /blocker_code.*null|null.*blocker_code/s.test(finalizer),
  'z01Finalizer.ts: clears blocker_code when prepared'
)

// ---- 7. ediel_message_id is set when ediel_message is prepared ----
assert(
  /ediel_message_id.*z01\.message.*id|z01\.message.*id.*ediel_message_id/s.test(infoRequests),
  'infoRequests.ts: sets ediel_message_id from z01.message.id'
)
assert(
  /edielMessageId.*z01\.message.*id|z01\.message.*id.*edielMessageId/s.test(finalizer),
  'z01Finalizer.ts: returns edielMessageId from prepared message'
)

// ---- 8. No direct SMTP send in finalizer or info requests dispatch ----
assert(
  !/smtp_send|sendEmail|send_email|createTransport|nodemailer/.test(finalizer),
  'z01Finalizer.ts: does NOT send SMTP directly'
)
assert(
  !/smtp_send|sendEmail|send_email|createTransport|nodemailer/.test(infoRequests),
  'infoRequests.ts: does NOT send SMTP directly'
)

// ---- 9. Duplicate pending GODRs are not created repeatedly ----
// infoRequests.ts should mark old pending GODRs as failed when creating/reusing one
assert(
  /grid_owner_data_requests[\s\S]{0,300}status.*failed|failed.*grid_owner_data_requests/s.test(infoRequests),
  'infoRequests.ts: marks old pending GODRs as failed when creating a new one'
)

// automation.ts requestForSite falls back to any active request (phase 2 lookup)
assert(
  /Phase 2|fallback.*without.*operation_id|without.*operation_id.*fallback/i.test(automation),
  'automation.ts: requestForSite has phase-2 fallback without operation_id filter'
)

// ---- 10a. Repair path is a server action (Option B: TypeScript-only, no SQL RPC) ----
const businessActions = read('app/admin/customers/[id]/business-actions.ts')
assert(
  /repairZ01CustomerInfoRequestAction/.test(businessActions),
  'business-actions.ts: repair path is a server action (Option B — TypeScript-only, no SQL RPC)'
)
assert(
  /finalizeStuckZ01GridOwnerDataRequest/.test(businessActions),
  'business-actions.ts: server action calls finalizeStuckZ01GridOwnerDataRequest'
)
// Verify no SQL RPC was added
const migrationDir = path.join(root, 'supabase/migrations')
const migrationFiles = require('fs').readdirSync(migrationDir).map((f) => {
  try { return require('fs').readFileSync(require('path').join(migrationDir, f), 'utf8') } catch { return '' }
})
assert(
  !migrationFiles.some((c) => /gridex_repair_z01_grid_owner_data_request_finalizer/.test(c)),
  'supabase/migrations: no SQL RPC gridex_repair_z01_grid_owner_data_request_finalizer (Option B)'
)

// ---- 10. ediel_messages uses correct column names ----
const edielTypes = read('lib/ediel/types.ts')
const edielTypeBlock = edielTypes.match(/EdielMessageRow\s*=\s*\{[\s\S]*?\}/)?.[0] ?? ''
assert(
  /message_sent_at/.test(edielTypeBlock),
  'EdielMessageRow type: uses message_sent_at (not sent_at)'
)
assert(
  !/\bsent_at\b/.test(edielTypeBlock.replace(/message_sent_at/g, '')),
  'EdielMessageRow type: does NOT have a bare sent_at field'
)
assert(
  /message_family/.test(edielTypeBlock),
  'EdielMessageRow type: uses message_family (not message_type)'
)
assert(
  !/\bmessage_type\b/.test(edielTypeBlock),
  'EdielMessageRow type: does NOT have message_type field'
)

// ---- New: finalizer always links the outbound and never sends SMTP directly ----
const finalizerSrc = read('lib/customer-operations/z01Finalizer.ts')
assert(
  /if \(cir\) \{/.test(finalizerSrc) && /outbound_request_id:\s*z01\.outbound\.id/.test(finalizerSrc),
  'z01Finalizer.ts: links customer_info_requests.outbound_request_id whenever the CIR exists'
)
assert(
  /smtp_sent:\s*false/.test(finalizerSrc),
  'z01Finalizer.ts: finalization audit records smtp_sent:false (no direct SMTP)'
)

console.log('\n✓ Z01 grid owner finalizer regression passed.')
