#!/usr/bin/env node
// Batch 2 regression: Z01 / facility lookup no-placeholder hardening.
// Verifies UNKNOWN/placeholder identifiers can never be rendered/sent, and that a
// genuinely missing facility/metering identifier is modelled as allowed-missing.
const fs = require('fs')
const path = require('path')
const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
function read(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const guard = read('lib/ediel/intent/noPlaceholderGuard.ts')
// The generic builder was renamed to the profile-driven renderer.
const generic = read('lib/ediel/prodat/builders/profileRenderer.ts')
const segments = read('lib/ediel/prodat/render/segments.ts')
const prodat = read('lib/ediel/prodat.ts')
const dispatch = read('lib/customer-operations/facilityLookupEdifactDispatch.ts')
const renderer = read('lib/ediel/intent/renderers/facilityLookupZ01.ts')
const engine = read('lib/ediel/intent/intentEngine.ts')

// No-placeholder guard
for (const token of ['UNKNOWN', 'MISSING', 'PLACEHOLDER']) {
  assert(guard.includes(`'${token}'`), `no-placeholder guard forbids ${token}`)
}
assert(guard.includes("'N/A'"), 'no-placeholder guard forbids N/A')
assert(guard.includes('export function collectPlaceholderViolations'), 'guard exposes collectPlaceholderViolations')
assert(guard.includes('export function isPlaceholderIdentifier'), 'guard exposes isPlaceholderIdentifier')

// The generic PRODAT builder no longer fabricates UNKNOWN and omits LIN when no id
assert(!/\|\|\s*'UNKNOWN'/.test(generic), "generic PRODAT builder no longer falls back to 'UNKNOWN'")
assert(generic.includes('hasObjectIdentifier') && generic.includes('if (hasObjectIdentifier)'), 'generic builder only emits LIN object id when a real id exists')
assert(generic.includes('objectIdentifierMissing'), 'generic builder reports objectIdentifierMissing diagnostic')

// Installation NAD renders address-only when no object id
assert(segments.includes("const partyId = meterPointId ? `${meterPointId}::9` : ''"), 'installation NAD omits fabricated id/agency when no object id')

// Switch render path no longer fabricates UNKNOWN
assert(!/\|\|\s*'UNKNOWN'/.test(prodat), "prodat.ts switch render no longer falls back to 'UNKNOWN'")

// Facility lookup dispatcher no longer uses the UNKNOWN placeholder
assert(!dispatch.includes("meterPointPlaceholder = 'UNKNOWN'"), 'facility dispatch no longer sets meterPointPlaceholder = UNKNOWN')
assert(!dispatch.includes("'UNKNOWN'"), 'facility dispatch contains no UNKNOWN literal')

// Allowed-missing is modelled explicitly, not as a placeholder string
assert(renderer.includes("allowedMissing") && renderer.includes("meterPointId: resolvedFacilityIdentifier ?? ''"), 'facility renderer models allowed-missing and never sends a placeholder')
assert(renderer.includes('Z01_FACILITY_LOOKUP_ALLOWS_MISSING_IDENTIFIER'), 'facility renderer documents the allowed-missing rule for Z01')

// Intent validation runs the no-placeholder guard
assert(engine.includes('collectPlaceholderViolations'), 'intent validation gate runs the no-placeholder guard')

// waiting_response only after outbox queue (queued dispatch_status path)
assert(dispatch.includes("status: 'waiting_response'") && dispatch.includes("dispatch_status: 'queued'"), 'request becomes waiting_response with queued dispatch only after outbox queue')

// Tenant sees plain Swedish (technical detail kept for superadmin only)
const translator = read('lib/ediel/intent/tenantStatusTranslator.ts')
assert(translator.includes('translateBlockingReasonsForTenant') && translator.includes('Vi väntar på svar från nätägaren'), 'tenant status translator produces plain Swedish')
assert(dispatch.includes('translateBlockingReasonsForTenant') && dispatch.includes('technicalMessage'), 'blocked dispatch shows tenant Swedish and keeps technical message for superadmin')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nBatch 2 Z01 no-placeholder regression passed.')
