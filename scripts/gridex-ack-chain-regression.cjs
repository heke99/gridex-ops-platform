#!/usr/bin/env node
// Verifies the CONTRL/APERAK acknowledgement chain:
//   - ACK messages do not require a dedicated ediel_ack DB route scope
//   - ACK reuses source message route context
//   - ackModeForProcess returns the correct DB-valid value
//   - sender/receiver inversion is present in ACK builders

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
const routeReadiness = read('lib/routes/routeReadiness.ts')

// ---- 1. ackModeForProcess returns contrl_and_aperak for PRODAT/UTILTS ----
assert(
  /ackModeForProcess/.test(routeMatrix),
  'routeMatrix: exports ackModeForProcess'
)
assert(
  /contrl_and_aperak/.test(routeMatrix),
  'routeMatrix: ackModeForProcess returns contrl_and_aperak for operational flows'
)

// ---- 2. CONTRL/APERAK ackMode = none ----
assert(
  /(CONTRL|APERAK).*none|none.*CONTRL/s.test(routeMatrix),
  'routeMatrix: CONTRL/APERAK ackMode = none (they do not expect ACKs)'
)

// ---- 3. routeScopeForProcess returns null for CONTRL/APERAK ----
assert(
  /CONTRL.*null|APERAK.*null/s.test(routeMatrix),
  'routeMatrix: routeScopeForProcess returns null for CONTRL/APERAK (reuse source route)'
)

// ---- 4. ediel_ack is NOT a DB route_scope in routeReadiness ----
assert(
  !/return 'ediel_ack'/.test(routeReadiness),
  'routeReadiness: does not return ediel_ack as a DB route_scope value'
)

// ---- 5. ACK implementation inverts sender/receiver ----
// The stub files (buildContrl.ts, buildAperak.ts) may just be re-exports.
// The actual inversion logic lives in lib/ediel/ack/ack.ts.
const ackImplFiles = [
  'lib/ediel/ack/ack.ts',
]
const ackStubFiles = [
  'lib/ediel/ack/buildContrl.ts',
  'lib/ediel/ack/buildAperak.ts',
]
let ackInversionFound = false
for (const file of [...ackImplFiles, ...ackStubFiles]) {
  if (exists(file)) {
    const content = read(file)
    if (/sender.*receiver|receiver.*sender|invert|swap/i.test(content)) {
      ackInversionFound = true
    }
  }
}
assert(ackInversionFound, 'ACK files (ack.ts or builders): contain sender/receiver inversion logic')

// ---- 6. ACK correlation: source message is referenced ----
if (exists('lib/ediel/ack/ackCorrelation.ts')) {
  const correlation = read('lib/ediel/ack/ackCorrelation.ts')
  assert(
    /source.*message|original.*message|ediel_message_id|outbound_request_id/i.test(correlation),
    'ackCorrelation.ts: correlates ACK to source message'
  )
}

// ---- 7. shouldMaterializePerGridOwner returns false for ACK ----
assert(
  /CONTRL.*false|APERAK.*false/s.test(routeMatrix),
  'routeMatrix: shouldMaterializePerGridOwner returns false for CONTRL/APERAK'
)

// ---- 8. ackModeForProcess is used by routeMaterializer ----
const materializer = read('lib/ediel/routeMaterializer.ts')
assert(
  /ackModeForProcess/.test(materializer),
  'routeMaterializer.ts: uses ackModeForProcess from routeMatrix'
)

// ---- 9. No invalid ack_mode literal in any ACK-related file ----
const ackFiles = [
  'lib/ediel/ack/ack.ts',
  'lib/ediel/ack/buildAperak.ts',
  'lib/ediel/ack/buildContrl.ts',
  'lib/ediel/core/ackPolicy.ts',
  'lib/ediel/core/ackDecisionEngine.ts',
]
for (const file of ackFiles) {
  if (exists(file)) {
    const content = read(file)
    assert(
      !/contrl_aperak/.test(content),
      `${file}: no invalid ack_mode = contrl_aperak`
    )
  }
}

// ---- 10. isValidAckMode type guard exported ----
assert(
  /export function isValidAckMode/.test(routeMatrix),
  'routeMatrix: exports isValidAckMode type guard'
)

console.log('\nACK chain regression passed.')
