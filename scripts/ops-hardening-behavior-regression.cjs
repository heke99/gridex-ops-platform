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

function makeThenableBuilder(result, recorder) {
  const builder = {
    update(payload) { recorder.updates.push(payload); return builder },
    select() { return builder },
    in() { return builder },
    order() { return builder },
    limit() { return builder },
    eq() { return builder },
    lt() { return builder },
    maybeSingle() { return builder },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) },
  }
  return builder
}

const edielRecorder = { updates: [], selects: 0 }
const { claimEdielOutboxItems } = loadTypeScriptModule('lib/ediel/outbox/claimOutboxItems.ts', {
  '@/lib/supabase/service': {
    supabaseService: {
      rpc: async () => ({ data: null, error: { message: 'Could not find the function claim_ediel_outbox_items' } }),
      from: () => ({
        update: (payload) => makeThenableBuilder({ data: null, error: null }, edielRecorder).update(payload),
        select: () => {
          edielRecorder.selects += 1
          return makeThenableBuilder({ data: [], error: null }, edielRecorder)
        },
      }),
    },
  },
})

claimEdielOutboxItems({ workerId: 'regression-worker', limit: 1 })
  .then((claimed) => {
    assert(Array.isArray(claimed) && claimed.length === 0, 'Fallback claim should return empty result from mocked queue')
    assert(
      edielRecorder.updates.some((payload) => payload.status === 'delivery_uncertain'),
      'Fallback claimant must move stale sending outbox rows to delivery_uncertain before claiming',
    )
    console.log('OPS behavior regression passed (Ediel stale sending fallback).')
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
