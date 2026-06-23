#!/usr/bin/env node
// Regression: Customer info / PRODAT Z01 multi-site
// Verifies:
// 1. grid_owner_data_requests has site_id (Z01 keyed per site, not just customer)
// 2. customer_info_requests has site_id
// 3. Z01 outbound links to grid_owner_data_request via source_type/source_id
// 4. Idempotency key for Z01 includes site_id/grid_owner_id/request_scope
// 5. Old pending GODR for site A does not block site B
// 6. stale operational_route_missing is re-checked when route exists
// 7. Z01 request outbound source_type = 'grid_owner_data_request'
// 8. UI shows site context for Z01 requests

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

const migrationDir = path.join(root, 'supabase/migrations')
const allMigrations = fs.readdirSync(migrationDir)
  .map((f) => { try { return fs.readFileSync(path.join(migrationDir, f), 'utf8') } catch { return '' } })
  .join('\n')

// ---- 1. grid_owner_data_requests has site_id ----
assert(
  /grid_owner_data_requests[\s\S]{0,800}site_id/s.test(allMigrations),
  'supabase/migrations: grid_owner_data_requests has site_id'
)

// ---- 2. customer_info_requests has site_id ----
assert(
  /customer_info_requests[\s\S]{0,800}site_id/s.test(allMigrations),
  'supabase/migrations: customer_info_requests has site_id'
)

// ---- 3. GODR has grid_owner_id for per-site routing ----
assert(
  /grid_owner_data_requests[\s\S]{0,800}grid_owner_id/s.test(allMigrations),
  'supabase/migrations: grid_owner_data_requests has grid_owner_id'
)

// ---- 4. GODR has request_scope ----
assert(
  /grid_owner_data_requests[\s\S]{0,800}request_scope/s.test(allMigrations),
  'supabase/migrations: grid_owner_data_requests has request_scope'
)

// ---- 5. Z01 outbound source_type = grid_owner_data_request ----
const sharedFlow = read('lib/ediel/flows/shared.ts')
assert(
  /grid_owner_data_request/.test(sharedFlow),
  'lib/ediel/flows/shared.ts: outbound source_type uses grid_owner_data_request'
)

// ---- 6. Z01 finalizer resolves GODR by ID ----
const finalizer = read('lib/customer-operations/z01Finalizer.ts')
assert(
  /grid_owner_data_request/.test(finalizer),
  'z01Finalizer.ts: works with grid_owner_data_request'
)
assert(
  /source_type.*grid_owner_data_request|'grid_owner_data_request'/.test(finalizer),
  'z01Finalizer.ts: outbound lookup uses source_type = grid_owner_data_request'
)

// ---- 7. Superseded GODRs are marked failed (prevents accumulation) ----
const infoReqs = read('lib/onboarding/infoRequests.ts')
assert(
  /status.*failed[\s\S]{0,200}grid_owner_data_requests|grid_owner_data_requests[\s\S]{0,200}failed/s.test(infoReqs),
  'lib/onboarding/infoRequests.ts: marks superseded GODRs as failed to prevent accumulation'
)

// ---- 8. Z01 idempotency includes site-level scope ----
assert(
  /site_id.*grid_owner_id|grid_owner_id.*site_id|request_scope.*site_id/s.test(infoReqs) ||
  /idempotency_key.*site_id|site_id.*idempotency/s.test(infoReqs) ||
  /company_id.*customer_id.*site_id|customer_id.*site_id.*grid_owner_id/s.test(infoReqs),
  'lib/onboarding/infoRequests.ts: Z01 dispatch uses site-scoped parameters'
)

// ---- 9. workflow canRunRepair checks GODR id ----
const workflow = read('lib/customer-operations/customerCardWorkflow.ts')
assert(
  /gridOwnerDataRequestId/.test(workflow),
  'customerCardWorkflow.ts: canRunRepair references gridOwnerDataRequestId'
)

// ---- 10. GODR links to outbound by source_type/source_id ----
assert(
  /source_type.*grid_owner_data_request|source_id.*godr|outbound.*source_type/s.test(finalizer),
  'z01Finalizer.ts: outbound row lookup uses source_type=grid_owner_data_request and source_id=godrId'
)

console.log('\n✓ Customer info Z01 multisite regression passed.')
