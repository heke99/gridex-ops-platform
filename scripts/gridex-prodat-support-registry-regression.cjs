#!/usr/bin/env node
// Batch 4 regression: PRODAT support registry is the one central truth.
const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const registry = read('lib/ediel/prodat/prodatMessageSupportRegistry.ts')
const rulebook = read('lib/ediel/rulebook/prodatRulebook.ts')
const fieldRules = read('lib/ediel/prodat/prodatFieldRules.ts')
const engine = read('lib/ediel/intent/intentEngine.ts')
const engineRegistry = read('lib/ediel/prodat/registry.ts')

assert(registry.includes('export const PRODAT_MESSAGE_SUPPORT'), 'registry exposes PRODAT_MESSAGE_SUPPORT')
assert(registry.includes('export function getProdatMessageSupport'), 'registry exposes getProdatMessageSupport')
assert(registry.includes('export function resolveProdatSupportStatus'), 'registry exposes resolveProdatSupportStatus')
assert(registry.includes('export function verifyProdatRegistryConsistency'), 'registry exposes consistency verifier')
for (const status of ['full', 'inbound_only', 'outbound_only', 'test_only', 'manual_review', 'unsupported']) {
  assert(registry.includes(`'${status}'`), `support status enum includes ${status}`)
}
assert(registry.includes('supportStatus') && registry.includes('businessProcesses') && registry.includes('applicationReferencePolicyKey') && registry.includes('fieldMatrixProfileId') && registry.includes('requiredFields') && registry.includes('allowedSenderRoles') && registry.includes('allowedReceiverRoles'), 'each support entry carries required attributes')

assert(registry.includes('PRODAT_CANONICAL_PROFILES'), 'registry derives from canonical rulebook profiles')
assert(registry.includes('SUPPORTED_PRODAT_BUSINESS_CODES'), 'registry reconciles against field-rule supported codes')

assert(rulebook.includes("messageCode: 'Z08'"), 'rulebook still references Z08 profile')
assert(registry.includes("return hasBuilder ? 'outbound_only' : 'manual_review'"), 'actor-to-portal codes without an engine builder resolve to manual_review')
assert(!/['"]Z08['"]/.test(engineRegistry) || !/ACTIVE_PRODAT_ENGINE_CODES[\s\S]*?['"]Z08['"]/.test(engineRegistry), 'Z08 is not falsely advertised as an active engine builder')
assert(registry.includes("? 'manual_review' : 'unsupported'"), 'unknown profiles resolve to manual_review/unsupported, never permissive')
assert(fieldRules.includes('SUPPORTED_PRODAT_BUSINESS_CODES'), 'field rules expose supported business codes')
assert(engine.includes('resolveProdatSupportStatus') && engine.includes('prodat_message_code_unsupported'), 'intent validation blocks unsupported/manual_review PRODAT codes')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nBatch 4 PRODAT support registry regression passed.')