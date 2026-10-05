#!/usr/bin/env node
// Verifies the CONTRL/APERAK acknowledgement chain and enforces that route
// transport code does not own canonical ACK semantics.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
const exists = (file) => {
  try { fs.accessSync(path.join(root, file)); return true } catch { return false }
}
const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const routeMatrix = read('lib/ediel/routeMatrix.ts')
const ackProjection = read('lib/ediel/ack/routeAckModeProjection.ts')
const canonicalAck = read('lib/ediel/ack/canonicalAckEngine.ts')
const routeReadiness = read('lib/routes/routeReadiness.ts')
const materializer = read('lib/ediel/routeMaterializer.ts')

// 1. Canonical ACK matrix owns normative semantics.
assert(/const ACK_MATRIX/.test(canonicalAck), 'canonicalAckEngine owns ACK matrix')
assert(/canonicalAckRequirements/.test(canonicalAck), 'canonicalAckEngine exports canonical requirements')
assert(!/ackModeForProcess/.test(routeMatrix), 'routeMatrix does not own ACK mode')
assert(!/contrl_and_aperak/.test(routeMatrix), 'routeMatrix contains no ack_mode semantics')

// 2. DB ack_mode is a separate projection that delegates canonical behavior.
assert(/projectCanonicalAckMode/.test(ackProjection), 'ACK projection exports projectCanonicalAckMode')
assert(/canonicalAckRequirements/.test(ackProjection), 'ACK projection reads canonical requirements')
assert(/export function isValidAckMode/.test(ackProjection), 'ACK projection exports isValidAckMode')
assert(/contrl_and_aperak/.test(ackProjection), 'ACK projection supports DB-valid contrl_and_aperak')
assert(!/contrl_aperak/.test(ackProjection), 'ACK projection never exposes invalid contrl_aperak')

// 3. Readiness/materializer consume the projection, never routeMatrix ACK helpers.
assert(/projectCanonicalAckMode/.test(routeReadiness), 'routeReadiness uses canonical ACK projection')
assert(/projectCanonicalAckMode/.test(materializer), 'routeMaterializer uses canonical ACK projection')
assert(!/ackModeForProcess/.test(routeReadiness), 'routeReadiness has no legacy ACK helper')
assert(!/ackModeForProcess/.test(materializer), 'routeMaterializer has no legacy ACK helper')

// 4. ACK/error messages reuse source route scope.
assert(/CONTRL.*APERAK.*UTILTS_ERR.*return null/s.test(routeMatrix), 'ACK/error families reuse source route')
assert(!/return 'ediel_ack'/.test(routeReadiness), 'routeReadiness never persists ediel_ack route_scope')

// 5. ACK implementation inverts sender/receiver.
const ackImplFiles = ['lib/ediel/ack.ts']
const ackStubFiles = ['lib/ediel/ack/buildContrl.ts', 'lib/ediel/ack/buildAperak.ts']
let ackInversionFound = false
for (const file of [...ackImplFiles, ...ackStubFiles]) {
  if (!exists(file)) continue
  const content = read(file)
  if (/sender.*receiver|receiver.*sender|invert|swap/i.test(content)) ackInversionFound = true
}
assert(ackInversionFound, 'ACK implementation contains sender/receiver inversion logic')

// 6. ACK correlation retains source-message linkage when module exists.
if (exists('lib/ediel/ack/ackCorrelation.ts')) {
  const correlation = read('lib/ediel/ack/ackCorrelation.ts')
  assert(/source.*message|original.*message|ediel_message_id|outbound_request_id/i.test(correlation), 'ACK correlation links response to source message')
}

// 7. No invalid legacy DB literal is reintroduced in ACK-related runtime.
for (const file of [
  'lib/ediel/ack.ts',
  'lib/ediel/ack/buildAperak.ts',
  'lib/ediel/ack/buildContrl.ts',
  'lib/ediel/core/ackPolicy.ts',
  'lib/ediel/ack/routeAckModeProjection.ts',
]) {
  if (exists(file)) assert(!/contrl_aperak/.test(read(file)), `${file}: no invalid contrl_aperak`)
}

console.log('\nACK chain regression passed.')
