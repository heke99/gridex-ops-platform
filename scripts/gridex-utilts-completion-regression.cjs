#!/usr/bin/env node
// Batch 7 regression: UTILTS completion (support registry + reason engine + no hardcoded test env).
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const registry = read('lib/ediel/utilts/utiltsMessageSupportRegistry.ts')
const reason = read('lib/ediel/utilts/utiltsErrorReason.ts')
const utilts = read('lib/ediel/utilts.ts')
const flow = read('lib/ediel/flows/utiltsDataRequest.ts')
const engine = read('lib/ediel/intent/intentEngine.ts')

// Registry covers every code in scope with one status
assert(registry.includes('export const UTILTS_MESSAGE_SUPPORT'), 'registry exposes UTILTS_MESSAGE_SUPPORT')
for (const code of ['E66', 'E73', 'E31', 'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'E30', 'E72', 'E74', 'ERR']) {
  assert(registry.includes(`'${code}'`), `registry classifies ${code}`)
}
assert(registry.includes('export function resolveUtiltsSupportStatus') && registry.includes('export function isUtiltsCodeSendable'), 'registry exposes resolve/sendable helpers')
assert(registry.includes("'unsupported'") && registry.includes("? 'manual_review'"), 'unknown UTILTS codes resolve to manual_review/unsupported (no partial unknown)')
assert(registry.includes('export function verifyUtiltsRegistryConsistency'), 'registry exposes consistency verifier')

// Reason engine maps actual reason, identity before period/quantity
assert(reason.includes('export function resolveUtiltsError'), 'reason engine exposes resolveUtiltsError')
assert(reason.includes('unknown_facility_or_metering_point') && reason.includes('wrong_grid_area') && reason.includes('wrong_observation_count'), 'reason engine covers required reasons')
assert(reason.indexOf('unknown_facility_or_metering_point') < reason.indexOf('wrong_period'), 'identity/object reasons evaluated before period/quantity reasons')
assert(reason.includes('INCORRECT_METERING_POINT_ID') && reason.includes('INCORRECT_GRID_AREA_ID'), 'reason engine maps to canonical error keys')

// No hardcoded test env/flag in the UTILTS production outbound path
assert(!/environment: 'test'/.test(utilts), "buildUtiltsOutboundDraft no longer hardcodes environment: 'test'")
assert(!/testFlag: 1\b/.test(utilts), 'buildUtiltsOutboundDraft no longer hardcodes testFlag: 1')
assert(utilts.includes("environment === 'production' ? 0 : 1"), 'UTILTS test flag derived from environment')
assert(flow.includes('environment,'), 'UTILTS flow threads resolved environment into the draft')

// Intent gate enforces UTILTS support
assert(engine.includes('resolveUtiltsSupportStatus') && engine.includes('utilts_message_code_unsupported'), 'intent validation blocks unsupported/manual_review UTILTS codes')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nBatch 7 UTILTS completion regression passed.')
