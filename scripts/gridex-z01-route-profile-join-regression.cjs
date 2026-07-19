#!/usr/bin/env node
// Regression: Z01 route-profile join
// Verifies:
// 1. No code assumes communication_routes.ediel_route_profile_id.
// 2. Resolver uses ediel_route_profiles.communication_route_id = communication_routes.id.
// 3. Outbound gets the profile id when the profile exists (even when blocked).
// 4. Profile disabled/not-ready maps to a precise blocker (not route_profile_missing).

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
    console.error(`\u274c ${message}`)
    process.exit(1)
  }
  console.log(`\u2705 ${message}`)
}

const routeEngine = read('lib/routes/routeDecisionEngine.ts')
const prodatFlow = read('lib/ediel/flows/prodatCustomerMasterdata.ts')
const finalizer = read('lib/customer-operations/z01Finalizer.ts')
const blockers = read('lib/customer-operations/blockers.ts')

// ---- 1. No code reads communication_routes.ediel_route_profile_id ----
const codeFiles = [
  'lib/routes/routeDecisionEngine.ts',
  'lib/ediel/flows/prodatCustomerMasterdata.ts',
  'lib/ediel/core/routeRegistry.ts',
  'lib/customer-operations/z01Finalizer.ts',
]
for (const file of codeFiles) {
  const content = read(file)
  assert(
    !/communication_routes[\s\S]{0,120}ediel_route_profile_id/.test(content),
    `${file}: does NOT assume communication_routes.ediel_route_profile_id`,
  )
}

// ---- 2. Resolver joins via ediel_route_profiles.communication_route_id ----
assert(
  /from\('ediel_route_profiles'\)[\s\S]{0,200}\.eq\('communication_route_id', routeId\)/.test(routeEngine),
  'routeDecisionEngine.ts: findRouteProfile joins ediel_route_profiles.communication_route_id = route id',
)
const finalizerJoin = /from\(["']ediel_route_profiles["']\)[\s\S]{0,320}\.eq\(["']communication_route_id["'], communicationRouteId\)/.test(finalizer)
assert(finalizerJoin, 'z01Finalizer.ts: dry-run route profile lookup uses communication_route_id join')

// ---- 3. Outbound gets the profile id even when blocked ----
assert(
  /persistOutboundRouteDecision/.test(prodatFlow) &&
    /ediel_route_profile_id:\s*decision\.edielRouteProfileId/.test(prodatFlow),
  'prodatCustomerMasterdata.ts: persists ediel_route_profile_id onto the outbound from the decision',
)
assert(
  /status:\s*'failed'/.test(prodatFlow) && /persistOutboundRouteDecision\(\{[\s\S]*?status:\s*'failed'/.test(prodatFlow),
  'prodatCustomerMasterdata.ts: persists profile id onto the outbound even on the blocked path',
)

// ---- 4. Disabled / not-ready map to precise blockers ----
assert(
  /code:\s*'route_profile_disabled'/.test(routeEngine),
  'routeDecisionEngine.ts: emits route_profile_disabled when profile exists but is_enabled=false',
)
assert(
  /code:\s*'production_route_profile_not_ready'/.test(routeEngine),
  'routeDecisionEngine.ts: emits production_route_profile_not_ready when profile not production-ready',
)
assert(
  /is_production_ready === false/.test(routeEngine) && /production_mode\) === 'disabled'/.test(routeEngine),
  'routeDecisionEngine.ts: not-ready check inspects is_production_ready / production_mode',
)
// The precise codes must not collapse to operational_route_missing.
assert(
  /route_profile_disabled/.test(blockers) && /production_route_profile_not_ready/.test(blockers),
  'blockers.ts: precise route-profile blockers are first-class (not collapsed to operational_route_missing)',
)
assert(
  /normalized\.includes\('production_route_profile_not_ready'\)/.test(blockers),
  'blockers.ts: routeIssueCodeToCustomerBlocker preserves production_route_profile_not_ready',
)

console.log('\n\u2713 Z01 route-profile join regression passed.')
