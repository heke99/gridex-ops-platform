#!/usr/bin/env node
// Regression: Test vs production separation
// Verifies:
// 1. Production route resolver does not read test actor settings (env-filtered).
// 2. Production route decision payload does not silently carry environment=test.
// 3. Test route resolver does not read production route profiles (env-filtered).
// 4. Missing environment fails closed (environment_missing).
// 5. First production send remains guarded (production send lock).

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`\u274c ${message}`)
    process.exit(1)
  }
  console.log(`\u2705 ${message}`)
}

const routeEngine = read('lib/routes/routeDecisionEngine.ts')
const senderResolver = read('lib/ediel/senderSettingsResolver.ts')
const dbOutbound = read('lib/cis/db-outbound.ts')
const prodatFlow = read('lib/ediel/flows/prodatCustomerMasterdata.ts')

// ---- 1. Actor settings filtered by environment ----
assert(
  /lower\(row\.environment\) === environment/.test(senderResolver),
  'senderSettingsResolver.ts: filters actor settings by exact environment',
)
assert(
  /\.eq\("environment", environment\)/.test(routeEngine),
  'routeDecisionEngine.ts: route profile lookup filters by environment',
)

// ---- 2. createOutboundRequest passes environment into the decision ----
assert(
  /environment:\s*input\.environment\s*\?\?\s*null/.test(dbOutbound),
  'db-outbound.ts: createOutboundRequest passes environment into decideCommunicationRoute',
)
assert(
  /environment:\s*params\.environment\s*\?\?\s*null/.test(read('lib/ediel/flows/shared.ts')),
  'shared.ts: findOrCreateDataRequestOutbound threads environment',
)
// Production decision payload top-level environment is persisted explicitly.
assert(
  /route_decision_payload:\s*\{\s*\.\.\.routeDecisionPayload\(decision\),\s*environment:/.test(prodatFlow),
  'prodatCustomerMasterdata.ts: outbound route_decision_payload carries explicit environment',
)

// ---- 3. Test must not select production profile / vice versa ----
assert(
  /test_route_profile_not_test/.test(routeEngine) &&
    /production_route_profile_not_production/.test(routeEngine),
  'routeDecisionEngine.ts: blocks cross-environment route profile selection both ways',
)

// ---- 4. Missing environment fails closed ----
assert(
  /failOnMissingEnvironment/.test(routeEngine) && /code:\s*"environment_missing"/.test(routeEngine),
  'routeDecisionEngine.ts: failOnMissingEnvironment emits environment_missing',
)
assert(
  /failOnMissingEnvironment:\s*true/.test(prodatFlow),
  'prodatCustomerMasterdata.ts: Z01 outbound creation requires explicit environment',
)
assert(
  /status:\s*"environment_missing"/.test(senderResolver),
  'senderSettingsResolver.ts: returns environment_missing instead of defaulting to test',
)

// ---- 5. First production send remains guarded ----
assert(
  /production_send_locked/.test(routeEngine) && /senderSettingProductionLockStatus/.test(routeEngine),
  'routeDecisionEngine.ts: first production send remains guarded by production send lock',
)

console.log('\n\u2713 Test/production separation regression passed.')
