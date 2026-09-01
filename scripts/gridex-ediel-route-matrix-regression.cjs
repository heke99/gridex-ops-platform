#!/usr/bin/env node
// Guards the final Ediel route architecture: routeMatrix owns transport scope
// only, while Application Reference and ACK semantics are canonical projections.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('node:child_process')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const routeMatrix = read('lib/ediel/routeMatrix.ts')
const ackProjection = read('lib/ediel/ack/routeAckModeProjection.ts')
const routeReadiness = read('lib/routes/routeReadiness.ts')
const materializer = read('lib/ediel/routeMaterializer.ts')
const fixMigration = read('supabase/migrations/20260622150000_ediel_route_ack_mode_fix_and_extended_materializer.sql')

assert(/export function routeScopeForProcess/.test(routeMatrix), 'routeMatrix exports routeScopeForProcess')
assert(/export function shouldMaterializePerGridOwner/.test(routeMatrix), 'routeMatrix exports shouldMaterializePerGridOwner')
for (const forbidden of [
  'ackModeForProcess',
  'applicationReferenceForProcess',
  'resolveApplicationReference',
  'canonicalAckRequirements',
  'getCanonicalUtiltsProfile',
]) {
  assert(!routeMatrix.includes(forbidden), `routeMatrix does not own ${forbidden}`)
}
assert(routeMatrix.includes('getCanonicalProdatProfile'), 'routeMatrix derives PRODAT route scope from canonical profiles')

for (const scope of [
  'customer_masterdata',
  'supplier_switch',
  'metering_access',
  'meter_values',
  'metering_values',
  'billing_underlay',
]) {
  assert(routeMatrix.includes(`'${scope}'`), `routeMatrix contains DB-valid scope ${scope}`)
}
assert(/ediel_route_scope_prodat_profile_missing/.test(routeMatrix), 'unknown PRODAT profile fails closed')
assert(/CONTRL.*APERAK.*UTILTS_ERR.*return null/s.test(routeMatrix), 'ACK/error families reuse source transport route')

assert(/export function projectCanonicalAckMode/.test(ackProjection), 'ACK projection exports projectCanonicalAckMode')
assert(ackProjection.includes('canonicalAckRequirements'), 'ACK projection delegates to canonical ACK engine')
assert(ackProjection.includes('getCanonicalProdatProfile'), 'ACK projection validates PRODAT code canonically')
assert(ackProjection.includes('getCanonicalUtiltsProfile'), 'ACK projection validates UTILTS code canonically')
assert(/export function isValidAckMode/.test(ackProjection), 'ACK projection owns DB ack_mode validation')
for (const mode of ['default', 'none', 'contrl_only', 'contrl_and_aperak']) {
  assert(ackProjection.includes(`'${mode}'`), `ACK projection contains DB-valid ack_mode ${mode}`)
}

assert(routeReadiness.includes('projectCanonicalAckMode'), 'routeReadiness delegates ACK mode to canonical projection')
assert(routeReadiness.includes('resolveProdatApplicationReferenceForProcess'), 'routeReadiness delegates PRODAT Application Reference canonically')
assert(!routeReadiness.includes('ackModeForProcess'), 'routeReadiness has no legacy route ACK helper')
assert(materializer.includes('projectCanonicalAckMode'), 'routeMaterializer delegates ACK mode to canonical projection')
assert(materializer.includes('validateRouteDeclaredApplicationReference'), 'routeMaterializer validates route Application Reference against canonical policy')
assert(materializer.includes('policyApplicationReference'), 'routeMaterializer persists canonical Application Reference')
assert(!materializer.includes('ackModeForProcess'), 'routeMaterializer has no legacy route ACK helper')
assert(!materializer.includes('applicationReferenceForProcess'), 'routeMaterializer has no legacy route Application Reference helper')

assert(/Z13.*Z14.*Z15.*Z18.*metering_access|metering_access.*Z13/s.test(fixMigration), 'fix migration maps metering-access rows to metering_access')
assert(/Z03.*Z04.*Z05.*Z06.*Z09.*Z10.*supplier_switch|supplier_switch.*Z03/s.test(fixMigration), 'fix migration maps supplier-switch rows to supplier_switch')
assert(!/set\s+ack_mode\s*=\s*'contrl_aperak'/i.test(fixMigration), 'fix migration never writes invalid contrl_aperak')

// Full-E2E preloads a logical-module reader for legacy static Gridex scripts.
// The normative authority scanner must inspect PHYSICAL source ownership so
// that an allowlisted utiltsEngine.part-1.ts literal is never attributed to its
// facade. Execute it in a clean child process whose entrypoint is not gridex-*.
const authority = spawnSync(process.execPath, [path.join(root, 'scripts/ediel-normative-authority-guard.cjs')], {
  cwd: root,
  encoding: 'utf8',
  env: process.env,
})
if (authority.stdout) process.stdout.write(authority.stdout)
if (authority.stderr) process.stderr.write(authority.stderr)
assert(authority.status === 0, 'Ediel normative authority guard passes against physical source files')

console.log('\nEDIEL route matrix regression passed.')