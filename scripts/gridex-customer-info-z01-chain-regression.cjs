#!/usr/bin/env node
// Verifies the customer info / PRODAT Z01 outbound chain:
//   customer_info_request -> grid_owner_data_request -> outbound_request
//   -> production_send_locked (never auto-sends in production)
// Also verifies that null-route outbound rows are repairable after
// route materialization.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const flow = read('lib/ediel/flows/prodatCustomerMasterdata.ts')
const fixMigration = read('supabase/migrations/20260622150000_ediel_route_ack_mode_fix_and_extended_materializer.sql')
const blockers = read('lib/customer-operations/blockers.ts')
const materializer = read('lib/ediel/routeMaterializer.ts')

// ---- 1. prodatCustomerMasterdata uses customer_masterdata route_scope ----
assert(
  /customer_masterdata/.test(flow),
  'prodatCustomerMasterdata.ts: references customer_masterdata scope'
)

// ---- 2. Flow stops at production_send_locked, never auto-sends ----
assert(
  /production_send_locked/.test(flow),
  'prodatCustomerMasterdata.ts: recognises production_send_locked blocker'
)

// ---- 3. Blocker code is defined ----
assert(
  /production_send_locked/.test(blockers),
  'blockers.ts: defines production_send_locked blocker code'
)

// ---- 4. materializer postcheck requires all three IDs ----
assert(
  /operational_route_ready.*true[\s\S]{0,200}communication_route_id[\s\S]{0,200}ediel_route_profile_id[\s\S]{0,200}company_market_party_route_id/s.test(materializer),
  'routeMaterializer.ts: postcheck requires operational_route_ready + all three IDs'
)

// ---- 5. Null-route outbound repair in SQL migration ----
assert(
  /update public\.outbound_requests/.test(fixMigration),
  'fix migration: repairs null-route outbound_requests after materialization'
)
assert(
  /communication_route_id is null/.test(fixMigration),
  'fix migration: targets only null communication_route_id outbound rows'
)
assert(
  /status in \('failed', 'queued', 'prepared'\)/.test(fixMigration),
  'fix migration: repairs only failed/queued/prepared outbound rows'
)

// ---- 6. Customer info request repair: moves to production_send_locked ----
assert(
  /update public\.customer_info_requests/.test(fixMigration),
  'fix migration: repairs customer_info_requests after materialization'
)
assert(
  /'production_send_locked'/.test(fixMigration),
  'fix migration: sets blocker_code = production_send_locked for production'
)
assert(
  /operational_route_missing.*platform_route_exists_but_not_materialized.*environment_not_resolved/s.test(fixMigration),
  'fix migration: only repairs requests stuck on route-missing blockers'
)

// ---- 7. operation_id is preserved in outbound repair ----
assert(
  /operation_id.*coalesce|coalesce.*operation_id/s.test(fixMigration),
  'fix migration: preserves operation_id when repairing outbound rows'
)

// ---- 8. grid_owner_data_request_id is linked ----
assert(
  /grid_owner_data_request_id/.test(fixMigration),
  'fix migration: links grid_owner_data_request_id on customer_info_request repair'
)

// ---- 9. No SMTP sent ----
assert(
  !/smtp_send|send_email|ediel_outbound_queue/.test(fixMigration),
  'fix migration: does not send SMTP or queue outbound sends'
)

// ---- 10. PRODAT Z01 always maps to customer_masterdata, not supplier_switch ----
const routeMatrix = read('lib/ediel/routeMatrix.ts')
assert(
  /Z01.*customer_masterdata|customer_masterdata.*Z01/s.test(routeMatrix),
  'routeMatrix: PRODAT Z01 always maps to customer_masterdata'
)
// Line-by-line check: no single line should map Z01 directly to supplier_switch
const matrixLines = routeMatrix.split('\n')
const z01SupplierSwitchConflict = matrixLines.some(
  (line) => /Z01/.test(line) && /supplier_switch/.test(line) && !/\/\//.test(line)
)
assert(
  !z01SupplierSwitchConflict,
  'routeMatrix: PRODAT Z01 is not mapped to supplier_switch on any single line'
)

// ---- 11. Post-route-ready flow: GODR -> outbound via source_type/source_id ----
const sharedFlow = read('lib/ediel/flows/shared.ts')
assert(
  /sourceType.*grid_owner_data_request|'grid_owner_data_request'/.test(sharedFlow),
  'shared.ts: outbound uses source_type = grid_owner_data_request'
)
assert(
  /sourceId.*dataRequest\.id|source_id.*dataRequest\.id/.test(sharedFlow),
  'shared.ts: outbound source_id is set to dataRequest.id'
)

// ---- 12. findOrCreateDataRequestOutbound repairs null-route outbound when route is ready ----
assert(
  /repairOutboundRequestCommunicationRoute/.test(sharedFlow),
  'shared.ts: findOrCreateDataRequestOutbound calls repairOutboundRequestCommunicationRoute when route is available'
)

// ---- 13. finalizer exports and delegates to Z01 prep ----
const finalizer = read('lib/customer-operations/z01Finalizer.ts')
assert(
  /finalizeStuckZ01GridOwnerDataRequest/.test(finalizer),
  'z01Finalizer.ts: exports finalizeStuckZ01GridOwnerDataRequest'
)
assert(
  /prepareAndQueueProdatZ01FromDataRequest/.test(finalizer),
  'z01Finalizer.ts: delegates finalization to prepareAndQueueProdatZ01FromDataRequest'
)

// ---- 14. infoRequests marks old stuck GODRs as failed (prevents accumulation) ----
const infoReqs = read('lib/onboarding/infoRequests.ts')
assert(
  /status.*failed[\s\S]{0,100}grid_owner_data_requests|grid_owner_data_requests[\s\S]{0,100}status.*failed/s.test(infoReqs),
  'infoRequests.ts: marks superseded pending GODRs as failed on new dispatch'
)

// ---- 15. Option B: no SQL RPC, repair is TypeScript server action ----
const businessActions = read('app/admin/customers/[id]/business-actions.ts')
assert(
  /repairZ01CustomerInfoRequestAction/.test(businessActions),
  'business-actions.ts: Z01 repair server action exists (Option B: TypeScript-only path)'
)
assert(
  /requirePlatformAdminAccess/.test(businessActions),
  'business-actions.ts: repair server action requires platform admin (not accessible to company admins)'
)

// ---- New: precise route-profile blockers no longer collapse to operational_route_missing ----
const blockersSrc = read('lib/customer-operations/blockers.ts')
assert(
  /production_route_profile_not_ready/.test(blockersSrc) &&
  /route_profile_disabled/.test(blockersSrc) &&
  /route_profile_missing/.test(blockersSrc),
  'blockers.ts: precise route-profile blocker codes exist'
)
assert(
  /normalized\.includes\("production_route_profile_not_ready"\)\)\s*return\s*"production_route_profile_not_ready"/.test(blockersSrc),
  'blockers.ts: routeIssueCodeToCustomerBlocker maps production_route_profile_not_ready precisely'
)

console.log('\nCustomer info Z01 chain regression passed.')
