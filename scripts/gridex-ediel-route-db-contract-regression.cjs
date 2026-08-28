#!/usr/bin/env node
// Verifies DB-valid EDIEL route literals while keeping protocol semantics out of
// the transport route matrix.

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

const materializer = read('lib/ediel/routeMaterializer.ts')
const routeMatrix = read('lib/ediel/routeMatrix.ts')
const ackProjection = read('lib/ediel/ack/routeAckModeProjection.ts')
const routeReadiness = read('lib/routes/routeReadiness.ts')
const decisionEngine = read('lib/routes/routeDecisionEngine.ts')
const bulkMigration = read('supabase/migrations/20260622133000_bulk_operational_route_materialization_repair.sql')
const fixMigration = read('supabase/migrations/20260622150000_ediel_route_ack_mode_fix_and_extended_materializer.sql')

// 1. No invalid ack_mode literal is written by current runtime/migrations.
assert(!/'contrl_aperak'/.test(materializer), 'routeMaterializer has no invalid contrl_aperak')
assert(!/'contrl_aperak'/.test(ackProjection), 'ACK projection has no invalid contrl_aperak')
assert(!/'contrl_aperak'/.test(bulkMigration), 'bulk migration has no invalid contrl_aperak')
assert(
  !/set\s+ack_mode\s*=\s*'contrl_aperak'/i.test(fixMigration) &&
  !/'edifact',\s*'contrl_aperak'/.test(fixMigration),
  'fix migration never writes contrl_aperak as a new value',
)

// 2. Valid ack_mode enum lives in the ACK compatibility projection, not routeMatrix.
for (const mode of ["'default'", "'none'", "'contrl_only'", "'contrl_and_aperak'"]) {
  assert(ackProjection.includes(mode), `ACK projection documents valid ack_mode ${mode}`)
}
assert(/projectCanonicalAckMode/.test(materializer), 'routeMaterializer uses canonical ACK projection')
assert(/canonicalAckRequirements/.test(ackProjection), 'ACK projection derives from canonical ACK authority')
assert(!/ackModeForProcess|contrl_and_aperak/.test(routeMatrix), 'routeMatrix owns no ACK semantics')

// 3. EDIEL communication route type remains DB-valid.
assert(/route_type:\s*"ediel_partner"|route_type:\s*'ediel_partner'/.test(materializer), 'routeMaterializer writes ediel_partner route_type')
assert(/ediel_partner/.test(bulkMigration), 'bulk migration writes ediel_partner route_type')
assert(!/route_type\s*=\s*'ediel'[^_]/.test(bulkMigration), 'bulk migration never writes bare ediel route_type')

// 4. transport_type belongs to route profiles, not communication_routes.
assert(!/transport_type[\s\S]{0,120}communication_routes/.test(bulkMigration), 'bulk migration does not add transport_type to communication_routes')

// 5. routeMatrix contains only DB route scopes.
for (const scope of [
  'customer_masterdata',
  'supplier_switch',
  'metering_access',
  'meter_values',
  'metering_values',
  'billing_underlay',
]) {
  assert(routeMatrix.includes(`'${scope}'`), `routeMatrix documents valid route_scope ${scope}`)
}

// 6. Runtime route consumers delegate transport scope and canonical policy.
assert(/routeScopeForProcess/.test(routeReadiness), 'routeReadiness delegates transport scope to routeMatrix')
assert(/projectCanonicalAckMode/.test(routeReadiness), 'routeReadiness delegates ACK semantics to canonical projection')
assert(!/return 'ediel_ack'/.test(routeReadiness), 'routeReadiness never emits ediel_ack DB route_scope')
assert(/validateRouteDeclaredApplicationReference/.test(materializer), 'routeMaterializer validates DB Application Reference against canonical authority')

// 7. Historical DB constraints remain protected.
assert(/'metering_access'/.test(fixMigration), 'fix migration includes metering_access route scope')
assert(/ediel_route_profiles_ack_mode_check/.test(fixMigration), 'fix migration contains ack_mode CHECK constraint')

// 8. Route decision sends messageCode into scope projection.
assert(
  /routeScopeForBusinessProcess\(input\.businessProcess,\s*messageCode\)/.test(decisionEngine),
  'routeDecisionEngine passes messageCode to routeScopeForBusinessProcess',
)

console.log('\nEDIEL route DB contract regression passed.')
