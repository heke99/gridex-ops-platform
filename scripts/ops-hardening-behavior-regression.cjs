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
