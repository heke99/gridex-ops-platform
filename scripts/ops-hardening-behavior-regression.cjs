const fs = require('fs')
const path = require('path')
const vm = require('vm')
const ts = require('typescript')

function loadTypeScriptModule(relative, mocks = {}) {
  const filename = path.join(process.cwd(), relative)
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const localRequire = (name) => Object.prototype.hasOwnProperty.call(mocks, name) ? mocks[name] : require(name)
  const sandbox = { exports: {}, module: { exports: {} }, require: localRequire, console, process, URL, AbortSignal }
  sandbox.exports = sandbox.module.exports
  vm.runInNewContext(output, sandbox, { filename })
  return sandbox.module.exports
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const { normaliseSwedishAddress } = loadTypeScriptModule('lib/energy/address.ts')
const cases = [
  ['Öresundsgatan 32', undefined, 'Öresundsgatan', '32', null],
  ['Storgatan 12A', undefined, 'Storgatan', '12A', null],
  ['Storgatan 12 B', undefined, 'Storgatan', '12B', null],
  ['Storgatan 12–14', undefined, 'Storgatan', '12–14', null],
  ['c/o Anna Andersson, Storgatan 12 B, lgh 1201', undefined, 'Storgatan', '12B', '1201'],
  ['Fabriksgatan', '7C', 'Fabriksgatan', '7C', null],
]
for (const [street, explicit, expectedStreet, expectedNumber, expectedApartment] of cases) {
  const parsed = normaliseSwedishAddress(street, explicit)
  assert(parsed.streetName === expectedStreet, `${street}: expected street ${expectedStreet}, got ${parsed.streetName}`)
  assert(parsed.streetNumber === expectedNumber, `${street}: expected number ${expectedNumber}, got ${parsed.streetNumber}`)
  assert(parsed.apartmentNumber === expectedApartment, `${street}: expected apartment ${expectedApartment}, got ${parsed.apartmentNumber}`)
}
console.log(`OPS behavior regression passed (${cases.length} Swedish address cases).`)


const { safeSvkServiceUrl } = loadTypeScriptModule('lib/energy/svkGeometryImport.ts', {
  '@/lib/supabase/service': { supabaseService: {} },
  '@/lib/runtime/dependencyErrors': { assertJsonResponse() {} },
  '@/lib/runtime/dependencyCircuit': { withDependencyCircuit: (_key, operation) => operation() },
})
assert(safeSvkServiceUrl(undefined).startsWith('https://services2.arcgis.com/L8WLzcxhwLqd80Jx/'), 'Default SVK URL must remain allowlisted')
for (const unsafe of [
  'http://services2.arcgis.com/L8WLzcxhwLqd80Jx/arcgis/rest/services/test',
  'https://localhost/arcgis/rest/services/test',
  'https://169.254.169.254/latest/meta-data',
  'https://services2.arcgis.com:444/L8WLzcxhwLqd80Jx/arcgis/rest/services/test',
  'https://services2.arcgis.com/other/arcgis/rest/services/test',
]) {
  let rejected = false
  try { safeSvkServiceUrl(unsafe) } catch { rejected = true }
  assert(rejected, `Unsafe SVK URL was accepted: ${unsafe}`)
}
console.log('OPS behavior regression passed (address parsing and SSRF allowlist).')

const {
  normalizeUuidOrNull,
  requireUuid,
  UuidValidationError,
} = loadTypeScriptModule('lib/validation/uuid.ts')
const sampleUuid = '123e4567-e89b-42d3-a456-426614174000'
assert(normalizeUuidOrNull('') === null, 'Empty UUID form values must normalize to null')
assert(normalizeUuidOrNull('   ') === null, 'Blank UUID form values must normalize to null')
assert(normalizeUuidOrNull(sampleUuid.toUpperCase()) === sampleUuid, 'UUIDs should be normalized to lowercase')
let invalidUuidRejected = false
try {
  normalizeUuidOrNull('not-a-uuid', 'metering_point_id')
} catch (error) {
  invalidUuidRejected = error instanceof UuidValidationError && /metering_point_id/.test(error.message)
}
assert(invalidUuidRejected, 'Invalid UUIDs must be rejected with a field-specific validation error')
assert(requireUuid(sampleUuid, 'customer_id') === sampleUuid, 'Required UUIDs should pass when valid')
console.log('OPS behavior regression passed (UUID normalization).')

// Both configured RPCs use the same atomic SQL claim owner. A missing RPC
// must propagate its database error without any direct table access or retry.
const outboxClaimCases = [
  {
    rpc: 'gridex_claim_ediel_outbox_progress_v1',
    params: { workerId: 'regression-worker', limit: 1, companyId: sampleUuid, environment: 'test' },
    args: { p_worker_id: 'regression-worker', p_limit: 1, p_company_id: sampleUuid, p_environment: 'test' },
  },
  {
    rpc: 'gridex_claim_ediel_outbox_batch_v1',
    params: { workerId: 'regression-worker', batchRunId: sampleUuid },
    args: { p_worker_id: 'regression-worker', p_run_id: sampleUuid },
  },
]

async function assertAtomicOutboxClaim(claimCase) {
  const calls = []
  let tableAccesses = 0
  const rpcError = { code: 'PGRST202', message: `Could not find the function ${claimCase.rpc}` }
  const mocks = {
    '@/lib/tenant/operationPolicy': { getTenantOperationDecision: async () => ({ allowed: true }) },
    '@/lib/supabase/service': {
      supabaseService: {
        rpc: async (name, args) => {
          calls.push({ name, args })
          return { data: null, error: rpcError }
        },
        from: () => {
          tableAccesses += 1
          throw new Error('Direct table access during claim')
        },
      },
    },
  }
  mocks['@/lib/supabase/tenantDb'] = loadTypeScriptModule('lib/supabase/tenantDb.ts', {
    '@/lib/supabase/service': mocks['@/lib/supabase/service'],
  })
  const { claimEdielOutboxItems } = loadTypeScriptModule('lib/ediel/outbox/claimOutboxItems.ts', mocks)
  let observedError
  try {
    await claimEdielOutboxItems(claimCase.params)
  } catch (error) {
    observedError = error
  }
  assert(observedError === rpcError, `${claimCase.rpc}: missing RPC must surface the original database error`)
  assert(calls.length === 1 && calls[0].name === claimCase.rpc, `Claiming must use exactly one ${claimCase.rpc} RPC`)
  const actualArgs = calls[0].args
  assert(
    actualArgs && Object.keys(actualArgs).length === Object.keys(claimCase.args).length &&
      Object.entries(claimCase.args).every(([key, value]) => actualArgs[key] === value),
    `${claimCase.rpc}: claim RPC must carry the exact worker and claim scope`,
  )
  assert(tableAccesses === 0, `${claimCase.rpc}: missing claim RPC must never fall back to direct table access`)
  console.log(`OPS behavior regression passed (${claimCase.rpc} is RPC-only and fails closed).`)
}

async function assertAtomicOutboxClaims() {
  for (const claimCase of outboxClaimCases) await assertAtomicOutboxClaim(claimCase)
}

assertAtomicOutboxClaims().catch(error => {
  console.error(error)
  process.exitCode = 1
})
