#!/usr/bin/env node
// Verifies that runtime route selection uses the full identity (company +
// environment + message_family + message_code + route_scope + counterparty)
// and that no cross-tenant or cross-environment leakage is possible from
// the code structure.

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

const decisionEngine = read('lib/routes/routeDecisionEngine.ts')
const routeMatrix = read('lib/ediel/routeMatrix.ts')
const routeReadiness = read('lib/routes/routeReadiness.ts')

// ---- 1. routeDecisionEngine uses message_code to derive scope ----
assert(
  /routeScopeForBusinessProcess\(input\.businessProcess,\s*messageCode\)/.test(decisionEngine),
  'routeDecisionEngine: passes messageCode to routeScopeForBusinessProcess'
)

// ---- 2. routeDecisionEngine uses full identity for route lookup ----
assert(
  /eq.*route_scope/.test(decisionEngine),
  'routeDecisionEngine: queries communication_routes by route_scope'
)
assert(
  /eq.*grid_owner_id/.test(decisionEngine),
  'routeDecisionEngine: queries communication_routes by grid_owner_id (counterparty)'
)
assert(
  /eq.*company_id/.test(decisionEngine),
  'routeDecisionEngine: queries communication_routes by company_id (tenant)'
)
assert(
  /eq.*is_active/.test(decisionEngine) || /is_active.*true/.test(decisionEngine),
  'routeDecisionEngine: queries only active routes'
)

// ---- 3. Environment isolation: profile lookup includes environment ----
assert(
  /eq.*environment/.test(decisionEngine),
  'routeDecisionEngine: queries ediel_route_profiles by environment'
)

// ---- 4. Production guard is applied ----
assert(
  /productionGuardIssues|isProduction|production_guard/.test(decisionEngine),
  'routeDecisionEngine: applies production guard checks'
)
assert(
  /isKnownTestEdielId/.test(decisionEngine),
  'routeDecisionEngine: rejects known test EDIEL IDs in production'
)

// ---- 5. Tenant isolation: company_id filter prevents cross-tenant leakage ----
// The query either requires company_id match or company_id is null (platform route)
assert(
  /company_id\.is\.null,company_id\.eq/.test(decisionEngine),
  'routeDecisionEngine: route lookup requires company_id match or null (platform-wide)'
)

// ---- 6. routeMatrix: PRODAT Z01 and Z03 are different scopes ----
// This ensures supplier_switch cannot use customer_masterdata route
const matrix = routeMatrix
assert(
  /Z01.*customer_masterdata/s.test(matrix) || /customer_masterdata.*Z01.*Z02/s.test(matrix),
  'routeMatrix: Z01 maps to customer_masterdata'
)
assert(
  /Z03.*supplier_switch|supplier_switch.*Z03/s.test(matrix),
  'routeMatrix: Z03 maps to supplier_switch'
)

// ---- 7. routeMatrix: UTILTS and PRODAT map to different scopes ----
assert(
  /family.*UTILTS.*meter_values/s.test(matrix),
  'routeMatrix: UTILTS maps to meter_values (not PRODAT scope)'
)
assert(
  /family.*PRODAT.*customer_masterdata/s.test(matrix),
  'routeMatrix: PRODAT fallback maps to customer_masterdata (not UTILTS scope)'
)

// ---- 8. ediel_ack does not produce a raw DB scope ----
assert(
  !/return 'ediel_ack'/.test(routeReadiness),
  'routeReadiness: does not return literal ediel_ack as DB scope'
)

// ---- 9. Test-to-production fallback prevention: target_system guard ----
assert(
  /production_ediel|target_system/.test(decisionEngine),
  'routeDecisionEngine: inspects target_system to guard test/production lanes'
)

// ---- 10. routeScopeForBusinessProcess passes messageCode ----
assert(
  /routeScopeForBusinessProcess.*messageCode|messageCode.*routeScopeForBusinessProcess/s.test(decisionEngine),
  'routeDecisionEngine: calls routeScopeForBusinessProcess with messageCode'
)

console.log('\nRoute runtime selection regression passed.')
