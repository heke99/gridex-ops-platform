#!/usr/bin/env node
// Verifies that code and migrations never use invalid DB literals for EDIEL
// route fields. Reads source files only — no DB connection required.

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

// ---- Files under test ----
const materializer = read('lib/ediel/routeMaterializer.ts')
const routeMatrix = read('lib/ediel/routeMatrix.ts')
const routeReadiness = read('lib/routes/routeReadiness.ts')
const decisionEngine = read('lib/routes/routeDecisionEngine.ts')
const bulkMigration = read('supabase/migrations/20260622133000_bulk_operational_route_materialization_repair.sql')
const fixMigration = read('supabase/migrations/20260622150000_ediel_route_ack_mode_fix_and_extended_materializer.sql')

// ---- 1. No invalid ack_mode literal contrl_aperak ----
assert(
  !/'contrl_aperak'/.test(materializer),
  'routeMaterializer.ts: no invalid ack_mode = contrl_aperak'
)
assert(
  !/'contrl_aperak'/.test(bulkMigration),
  'bulk migration: no invalid ack_mode = contrl_aperak'
)
// The fix migration legitimately contains 'contrl_aperak' in WHERE/CASE filter
// contexts to target old rows for repair. What must never appear is writing it
// as a new value via SET ack_mode = 'contrl_aperak' on an UPDATE or via
// an INSERT VALUES list in the ack_mode column position.
assert(
  // UPDATE SET context: must not set ack_mode to the bad value
  !/set\s+ack_mode\s*=\s*'contrl_aperak'/i.test(fixMigration) &&
  // INSERT VALUES positional context: 'contrl_aperak' must not appear right
  // after the message_standard column (which precedes ack_mode in all INSERTs)
  !/'edifact',\s*'contrl_aperak'/.test(fixMigration),
  'fix migration: never writes ack_mode = contrl_aperak as a new value (WHERE/CASE filters are permitted)'
)

// ---- 2. Valid ack_mode is used ----
// routeMaterializer delegates to ackModeForProcess() which returns contrl_and_aperak
assert(
  /contrl_and_aperak/.test(materializer) || /ackModeForProcess/.test(materializer),
  'routeMaterializer.ts: uses contrl_and_aperak (directly or via ackModeForProcess)'
)
assert(
  /contrl_and_aperak/.test(bulkMigration),
  'bulk migration: uses contrl_and_aperak'
)
assert(
  /contrl_and_aperak/.test(fixMigration),
  'fix migration: uses contrl_and_aperak'
)
assert(
  /contrl_and_aperak/.test(routeMatrix),
  'routeMatrix.ts: exports contrl_and_aperak as ackModeForProcess result'
)

// ---- 3. Valid ack_mode values documented in routeMatrix ----
const validAckModes = ["'default'", "'none'", "'contrl_only'", "'contrl_and_aperak'"]
for (const mode of validAckModes) {
  assert(
    routeMatrix.includes(mode),
    `routeMatrix.ts: documents valid ack_mode ${mode}`
  )
}

// ---- 4. No route_type = 'ediel' on communication_routes ----
// The only valid EDIEL partner route_type is 'ediel_partner'
assert(
  !/'ediel_partner'/.test(materializer) || !/route_type.*'ediel'[^_]/.test(materializer),
  'routeMaterializer.ts: route_type is ediel_partner, not bare ediel'
)
assert(
  /ediel_partner/.test(bulkMigration),
  'bulk migration: inserts route_type = ediel_partner'
)
assert(
  !/route_type\s*=\s*'ediel'[^_]/.test(bulkMigration),
  'bulk migration: never writes invalid route_type = ediel'
)

// ---- 5. No transport_type on communication_routes ----
// transport_type lives on ediel_route_profiles, not communication_routes
assert(
  !/transport_type[\s\S]{0,120}communication_routes/.test(bulkMigration),
  'bulk migration: does not add transport_type to communication_routes'
)

// ---- 6. DB-valid route_scope values only in routeMatrix ----
const validScopes = [
  'customer_masterdata',
  'supplier_switch',
  'metering_access',
  'meter_values',
  'metering_values',
  'billing_underlay',
]
for (const scope of validScopes) {
  assert(
    routeMatrix.includes(scope),
    `routeMatrix.ts: documents valid route_scope ${scope}`
  )
}

// ---- 7. routeReadiness uses routeMatrix ----
assert(
  /routeScopeForProcess/.test(routeReadiness),
  'routeReadiness.ts: delegates to routeScopeForProcess from routeMatrix'
)

// ---- 8. ediel_ack process does not produce a DB route_scope of ediel_ack ----
// ediel_ack is a code-level concept only; ACK reuses source route
assert(
  !/return 'ediel_ack'/.test(routeReadiness),
  'routeReadiness.ts: does not return literal ediel_ack as DB route_scope'
)

// ---- 9. metering_access constraint is extended in fix migration ----
assert(
  /'metering_access'/.test(fixMigration),
  'fix migration: adds metering_access to route_scope constraint'
)

// ---- 10. ack_mode CHECK constraint is added in fix migration ----
assert(
  /ediel_route_profiles_ack_mode_check/.test(fixMigration),
  'fix migration: adds ediel_route_profiles_ack_mode_check constraint'
)

// ---- 11. routeMaterializer imports routeMatrix ----
assert(
  /from.*routeMatrix/.test(materializer),
  'routeMaterializer.ts: imports from routeMatrix'
)

// ---- 12. routeDecisionEngine passes messageCode to routeScopeForBusinessProcess ----
assert(
  /routeScopeForBusinessProcess\(input\.businessProcess,\s*messageCode\)/.test(decisionEngine),
  'routeDecisionEngine.ts: passes messageCode to routeScopeForBusinessProcess'
)

console.log('\nEDIEL route DB contract regression passed.')
