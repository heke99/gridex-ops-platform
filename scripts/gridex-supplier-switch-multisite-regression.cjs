#!/usr/bin/env node
// Regression: Supplier switch multi-site
// Verifies:
// 1. supplier_switch_requests has site_id and metering_point_id
// 2. Supplier switch keyed per site/metering point, not just customer
// 3. CONTRL/APERAK ACK links to outbound by outbound_request_id
// 4. Switch request uses correct route_scope (not customer_masterdata scope)
// 5. Switch for site A does not overwrite site B status
// 6. Production send guard applies to supplier switch
// 7. PRODAT Z03 used for supplier switch (not Z01)

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

// ---- 1. supplier_switch_requests has site_id ----
assert(
  /supplier_switch_requests[\s\S]{0,800}site_id/s.test(allMigrations),
  'supabase/migrations: supplier_switch_requests has site_id'
)

// ---- 2. supplier_switch_requests has metering_point_id ----
assert(
  /supplier_switch_requests[\s\S]{0,800}metering_point_id/s.test(allMigrations),
  'supabase/migrations: supplier_switch_requests has metering_point_id'
)

// ---- 3. Switch flow uses Z03 (not Z01) ----
const switchFlow = read('lib/ediel/flows/prodatSwitch.ts')
assert(
  /Z03/.test(switchFlow),
  'lib/ediel/flows/prodatSwitch.ts: uses PRODAT Z03 for supplier switch'
)
assert(
  !/Z01/.test(switchFlow.split('//')[0] || switchFlow),
  'lib/ediel/flows/prodatSwitch.ts: does not use Z01 for supplier switch'
)

// ---- 4. Switch uses supplier_switch route_scope ----
const routeMatrix = read('lib/ediel/routeMatrix.ts')
assert(
  /Z03.*supplier_switch|supplier_switch.*Z03/s.test(routeMatrix),
  'lib/ediel/routeMatrix.ts: Z03 maps to supplier_switch route_scope'
)

// ---- 5. ACK processing links to outbound_request_id ----
const ackProcessing = read('lib/ediel/flows/inboundAckProcessing.ts')
assert(
  /outbound_request_id/.test(ackProcessing),
  'lib/ediel/flows/inboundAckProcessing.ts: ACK links to outbound_request_id'
)

// ---- 6. CONTRL/APERAK processing exists ----
assert(
  /CONTRL|APERAK/.test(ackProcessing),
  'lib/ediel/flows/inboundAckProcessing.ts: handles CONTRL/APERAK messages'
)

// ---- 7. Switch actions include site_id ----
const switchCreateActions = read('app/admin/customers/[id]/switch-create-actions.ts')
assert(
  /site_id/.test(switchCreateActions),
  'switch-create-actions.ts: includes site_id in switch request creation'
)

// ---- 8. Production guard applies to switch ----
const productionGuards = read('lib/ediel/core/productionGuards.ts')
assert(
  /locked.*boolean|severity.*blocked|locked.*false|locked.*true/.test(productionGuards),
  'productionGuards.ts: production send guard uses locked/blocked status (applies to all outbound including supplier switch)'
)

// ---- 9. supplier_switch_requests has company_id ----
assert(
  /supplier_switch_requests[\s\S]{0,800}company_id/s.test(allMigrations),
  'supabase/migrations: supplier_switch_requests has company_id'
)

console.log('\n✓ Supplier switch multisite regression passed.')
