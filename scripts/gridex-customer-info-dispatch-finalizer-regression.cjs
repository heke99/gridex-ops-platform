#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
  console.log(`✓ ${message}`)
}

const dbData = read('lib/cis/db-data.ts')
const dbOutbound = read('lib/cis/db-outbound.ts')
const shared = read('lib/ediel/flows/shared.ts')
const info = read('lib/onboarding/infoRequests.ts')
const prepare = read('lib/ediel/flows/prodatCustomerMasterdata.ts')
const automation = read('lib/customer-operations/automation.ts')
const migration = read('supabase/migrations/20260621123000_customer_info_dispatch_finalizer.sql')
const pkg = JSON.parse(read('package.json'))

assert(/createGridOwnerDataRequest\(input: \{[\s\S]*operationId\?: string \| null/.test(dbData), 'createGridOwnerDataRequest accepts operationId.')
assert(/operation_id: input\.operationId \?\? null/.test(dbData), 'createGridOwnerDataRequest writes operation_id.')
assert(/existingByOperationQuery[\s\S]*operation_id/.test(dbData), 'grid-owner request dedupe uses operation_id.')
assert(/createOutboundRequest\(input: \{[\s\S]*operationId\?: string \| null/.test(dbOutbound), 'createOutboundRequest accepts operationId.')
assert(/payload: mergeJsonObjects\(enrichedPayload,[\s\S]*operation_id: input\.operationId/.test(dbOutbound) || /operation_id: input\.operationId \?\? null/.test(dbOutbound), 'createOutboundRequest persists operation_id in row and payload.')
assert(/findOrCreateDataRequestOutbound\(params: \{[\s\S]*operationId\?: string \| null/.test(shared), 'findOrCreateDataRequestOutbound accepts operationId.')
assert(/operationId: params\.operationId \?\? params\.dataRequest\.operation_id \?\? null/.test(shared), 'findOrCreateDataRequestOutbound forwards operationId.')
assert(/operationId: request\.operation_id|operationId = normalizeUuidOrNull\(request\.operation_id/.test(info), 'customer info dispatch reads request.operation_id.')
// The outbound call gained more canonical fields (authorizationDocumentId,
// requestPayload) after operationId; the invariant is unchanged: operationId
// is passed and the grid_owner_data_request is linked before Z01 prepare.
assert(/operationId,[\s\S]{0,400}\}\);\n\n\s*const linkNow/.test(info), 'customer info dispatch passes operationId and links grid_owner_data_request before Z01 prepare.')
assert(/grid_owner_data_request_id: gridOwnerDataRequest\.id[\s\S]*route_resolution_status: 'grid_owner_request_created'/.test(info), 'customer_info_request is linked immediately after grid-owner request creation.')
assert(/prepareAndQueueProdatZ01FromDataRequest\([\s\S]*operationId/.test(info), 'queueCustomerInfoRequestForDispatch forwards operationId to Z01 prepare.')
assert(/customerInfoStatusFromZ01Result/.test(info) && !/const nextStatus = z01\.prepared \? "z01_prepared" : "route_missing"/.test(info), 'Z01 result status mapping prevents plain draft/over-generic route_missing.')
assert(/dispatchBlockerFromError/.test(info) && /production_send_locked/.test(info) && /platform_route_exists_but_not_materialized/.test(info), 'known dispatch blockers are captured as structured blockers.')
assert(/status = 'needs_review'/.test(migration) && /last_error = null/.test(migration), 'migration repairs retrying customer-operation jobs into needs_review.')
assert(/grid_owner_data_requests\(company_id, operation_id/.test(migration), 'migration indexes grid-owner operation correlation.')
assert(/outbound_requests\(company_id, source_type, source_id, request_type, operation_id/.test(migration), 'migration indexes outbound operation correlation.')
assert(/grid_owner_data_request_id = candidates\.grid_owner_data_request_id/.test(migration), 'migration repairs draft request to grid-owner request link.')
assert(pkg.scripts['gridex:customer-info-dispatch-finalizer-regression'] === 'node scripts/gridex-customer-info-dispatch-finalizer-regression.cjs', 'package.json exposes finalizer regression script.')
assert(/linkOperationResources/.test(automation) && /gridOwnerDataRequestId: dispatch\.gridOwnerDataRequestId/.test(automation), 'automation links dispatch resources back to the operation.')
assert(/z01_prepared_pending_send_guard/.test(automation), 'automation records prepared Z01 as send-guard review instead of generic failure.')

console.log('gridex customer info dispatch finalizer regression: passed')
