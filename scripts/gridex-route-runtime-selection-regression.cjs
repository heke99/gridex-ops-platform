#!/usr/bin/env node
// Verifies that runtime route selection uses the full identity and derives
// PRODAT transport scope from the canonical rulebook instead of duplicating
// message-code mappings in the transport layer.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
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

const decisionEngine = read('lib/routes/routeDecisionEngine.ts')
const routeMatrix = read('lib/ediel/routeMatrix.ts')
const rulebook = read('lib/ediel/rulebook/prodatRulebook.ts')
const routeReadiness = read('lib/routes/routeReadiness.ts')

assert(
  /routeScopeForBusinessProcess\(input\.businessProcess,\s*messageCode\)/.test(decisionEngine),
  'routeDecisionEngine: passes messageCode to routeScopeForBusinessProcess'
)
assert(/eq.*route_scope/.test(decisionEngine), 'routeDecisionEngine: queries communication_routes by route_scope')
assert(/eq.*grid_owner_id/.test(decisionEngine), 'routeDecisionEngine: queries communication_routes by grid_owner_id')
assert(
  /company_id\.eq\./.test(decisionEngine) &&
    /company_id\.is\.null/.test(decisionEngine) &&
    /row\.company_id === params\.companyId/.test(decisionEngine),
  'routeDecisionEngine: tenant rows are preferred over platform-global routes'
)
assert(/eq.*is_active/.test(decisionEngine) || /is_active.*true/.test(decisionEngine), 'routeDecisionEngine: queries only active routes')
assert(/eq.*environment/.test(decisionEngine), 'routeDecisionEngine: route profile lookup includes environment')
assert(/productionGuardIssues|isProduction|production_guard/.test(decisionEngine), 'routeDecisionEngine: applies production guard checks')
assert(/isKnownTestEdielId/.test(decisionEngine), 'routeDecisionEngine: rejects known test EDIEL IDs in production')
assert(/company_id\.is\.null,company_id\.eq/.test(decisionEngine), 'routeDecisionEngine: route lookup cannot leak another tenant')

// Canonical PRODAT routing: routeMatrix contains no hand-maintained Z-code map.
assert(routeMatrix.includes('getCanonicalProdatProfile'), 'routeMatrix delegates PRODAT classification to canonical profiles')
assert(
  routeMatrix.includes("profile.processGroup === 'customer_masterdata'") &&
  routeMatrix.includes("return 'customer_masterdata'"),
  'routeMatrix projects customer_masterdata process group to customer_masterdata scope'
)
assert(
  routeMatrix.includes("profile.processGroup === 'supplier_switch'") &&
  routeMatrix.includes("return 'supplier_switch'"),
  'routeMatrix projects supplier_switch process group to supplier_switch scope'
)
assert(
  /messageCode: 'Z01'[\s\S]*?processGroup: 'customer_masterdata'/.test(rulebook),
  'canonical rulebook classifies Z01 as customer_masterdata'
)
assert(
  /messageCode: 'Z03'[\s\S]*?processGroup: 'supplier_switch'/.test(rulebook),
  'canonical rulebook classifies Z03 as supplier_switch'
)
assert(routeMatrix.includes('ediel_route_scope_prodat_profile_missing'), 'unknown PRODAT code fails closed instead of using a fallback')
assert(/family === 'UTILTS'/.test(routeMatrix) && /return 'meter_values'/.test(routeMatrix), 'UTILTS projects to meter_values transport scope')
assert(!/return 'ediel_ack'/.test(routeReadiness), 'routeReadiness: does not return literal ediel_ack as DB scope')
assert(/production_ediel|target_system/.test(decisionEngine), 'routeDecisionEngine: inspects target_system for test/production isolation')
assert(/routeScopeForBusinessProcess.*messageCode|messageCode.*routeScopeForBusinessProcess/s.test(decisionEngine), 'routeDecisionEngine: calls routeScopeForBusinessProcess with messageCode')

console.log('\nRoute runtime selection regression passed.')