#!/usr/bin/env node
// Verifies the customer info / PRODAT Z01 outbound chain:
// customer_info_request -> grid_owner_data_request -> outbound_request ->
// production_send_locked, with Z01 transport scope projected from canonical
// PRODAT policy rather than a duplicate message-code matrix.

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

assert(/customer_masterdata/.test(flow), 'prodatCustomerMasterdata.ts: references customer_masterdata scope')
assert(/production_send_locked/.test(flow), 'prodatCustomerMasterdata.ts: recognises production_send_locked blocker')
assert(/production_send_locked/.test(blockers), 'blockers.ts: defines production_send_locked blocker code')
assert(
  /operational_route_ready.*true[\s\S]{0,200}communication_route_id[\s\S]{0,200}ediel_route_profile_id[\s\S]{0,200}company_market_party_route_id/s.test(materializer),
  'routeMaterializer.ts: postcheck requires operational_route_ready + all three IDs'
)
assert(/update public\.outbound_requests/.test(fixMigration), 'fix migration: repairs null-route outbound_requests after materialization')
assert(/communication_route_id is null/.test(fixMigration), 'fix migration: targets only null communication_route_id outbound rows')
assert(/status in \('failed', 'queued', 'prepared'\)/.test(fixMigration), 'fix migration: repairs only failed/queued/prepared outbound rows')
assert(/update public\.customer_info_requests/.test(fixMigration), 'fix migration: repairs customer_info_requests after materialization')
assert(/'production_send_locked'/.test(fixMigration), 'fix migration: sets blocker_code = production_send_locked for production')
assert(/operational_route_missing.*platform_route_exists_but_not_materialized.*environment_not_resolved/s.test(fixMigration), 'fix migration: only repairs requests stuck on route-missing blockers')
assert(/operation_id.*coalesce|coalesce.*operation_id/s.test(fixMigration), 'fix migration: preserves operation_id when repairing outbound rows')
assert(/grid_owner_data_request_id/.test(fixMigration), 'fix migration: links grid_owner_data_request_id on customer_info_request repair')
assert(!/smtp_send|send_email|ediel_outbound_queue/.test(fixMigration), 'fix migration: does not send SMTP or queue outbound sends')

const routeMatrix = read('lib/ediel/routeMatrix.ts')
const prodatRulebook = read('lib/ediel/rulebook/prodatRulebook.ts')
assert(routeMatrix.includes('getCanonicalProdatProfile'), 'routeMatrix: delegates PRODAT routing to canonical profile authority')
assert(
  routeMatrix.includes("profile.processGroup === 'customer_masterdata'") &&
    routeMatrix.includes("return 'customer_masterdata'"),
  'routeMatrix: canonical customer_masterdata process projects to customer_masterdata transport scope'
)
assert(
  /messageCode: 'Z01'[\s\S]*?processGroup: 'customer_masterdata'/.test(prodatRulebook),
  'prodatRulebook: Z01 is canonically classified as customer_masterdata'
)
const matrixLines = routeMatrix.split('\n')
const z01SupplierSwitchConflict = matrixLines.some(
  (line) => /Z01/.test(line) && /supplier_switch/.test(line) && !/\/\//.test(line)
)
assert(!z01SupplierSwitchConflict, 'routeMatrix: no direct Z01 -> supplier_switch override exists')

const sharedFlow = read('lib/ediel/flows/shared.ts')
assert(/sourceType.*grid_owner_data_request|'grid_owner_data_request'/.test(sharedFlow), 'shared.ts: outbound uses source_type = grid_owner_data_request')
assert(/sourceId.*dataRequest\.id|source_id.*dataRequest\.id/.test(sharedFlow), 'shared.ts: outbound source_id is dataRequest.id')
assert(/repairOutboundRequestCommunicationRoute/.test(sharedFlow), 'shared.ts: existing null-route outbound is repaired when route is available')

const finalizer = read('lib/customer-operations/z01Finalizer.ts')
assert(/finalizeStuckZ01GridOwnerDataRequest/.test(finalizer), 'z01Finalizer.ts: exports finalizeStuckZ01GridOwnerDataRequest')
assert(/prepareAndQueueProdatZ01FromDataRequest/.test(finalizer), 'z01Finalizer.ts: delegates finalization to canonical Z01 preparation')

const infoReqs = read('lib/onboarding/infoRequests.ts')
assert(/status.*failed[\s\S]{0,100}grid_owner_data_requests|grid_owner_data_requests[\s\S]{0,100}status.*failed/s.test(infoReqs), 'infoRequests.ts: superseded pending GODRs are failed on new dispatch')

const businessActions = read('app/admin/customers/[id]/business-actions.ts')
assert(/repairZ01CustomerInfoRequestAction/.test(businessActions), 'business-actions.ts: Z01 repair server action exists')
assert(/requirePlatformAdminAccess/.test(businessActions), 'business-actions.ts: repair requires platform admin')

const blockersSrc = read('lib/customer-operations/blockers.ts')
assert(/production_route_profile_not_ready/.test(blockersSrc) && /route_profile_disabled/.test(blockersSrc) && /route_profile_missing/.test(blockersSrc), 'blockers.ts: precise route-profile blocker codes exist')
assert(/normalized\.includes\("production_route_profile_not_ready"\)\)\s*return\s*"production_route_profile_not_ready"/.test(blockersSrc), 'blockers.ts: production_route_profile_not_ready maps precisely')

console.log('\nCustomer info Z01 chain regression passed.')