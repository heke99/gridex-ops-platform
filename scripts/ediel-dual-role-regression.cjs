#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = process.cwd()
const originalResolve = Module._resolveFilename

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://dual-role-regression-placeholder.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'dual-role-regression-placeholder-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'dual-role-regression-placeholder-service-role-key'

function existingFile(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}

Module._resolveFilename = function resolveTsAlias(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const mapped = path.join(root, request.slice(2))
    const candidate = existingFile([`${mapped}.ts`, `${mapped}.tsx`, path.join(mapped, 'index.ts'), mapped])
    if (candidate) return candidate
  }
  if (request.startsWith('.')) {
    const base = path.resolve(path.dirname(parent?.filename ?? root), request)
    const candidate = existingFile([`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base])
    if (candidate) return candidate
  }
  return originalResolve.call(this, request, parent, isMain, options)
}

require.extensions['.ts'] = function loadTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText
  module._compile(output, filename)
}

const {
  EDIEL_AGT_2026A_CASES,
  getEdielAgtTestCaseByCode,
  listEdielAgt2026Cases,
} = require('../lib/ediel/agtRegistry.ts')
const {
  applicationReferenceForActor,
  normalizeActorRole,
  normalizeActorSubrole,
  normalizeEnvironmentType,
  roleCodeForActorRole,
  supplierBrpRelevantForRole,
} = require('../lib/ediel/actorRoles.ts')
const { evaluateEdielProductionSendLock } = require('../lib/ediel/core/productionGuards.ts')

function codes(cases) {
  return cases.map((testCase) => testCase.testCaseCode).sort()
}

assert.deepStrictEqual(
  codes(listEdielAgt2026Cases({ roleCode: 'supplier', suite: 'PRODAT' })),
  ['L1', 'L2', 'L3', 'L4', 'L5', 'L7'],
  'supplier PRODAT AGT cases must stay L1-L5/L7'
)
assert.deepStrictEqual(
  codes(listEdielAgt2026Cases({ roleCode: 'supplier', suite: 'UTILTS' })),
  ['UL1', 'UL2', 'UL3', 'UL4', 'UL6'],
  'supplier UTILTS AGT cases must stay UL1-UL4/UL6'
)
assert.deepStrictEqual(
  codes(listEdielAgt2026Cases({ roleCode: 'esco', suite: 'PRODAT' })),
  ['E3', 'E4', 'E5', 'E6', 'E7', 'E8'],
  'DGI PRODAT AGT cases must cover E3-E8'
)
assert.deepStrictEqual(
  codes(listEdielAgt2026Cases({ roleCode: 'esco', suite: 'UTILTS' })),
  ['UE1', 'UE2'],
  'DGI UTILTS AGT cases must cover UE1-UE2'
)

for (const testCase of EDIEL_AGT_2026A_CASES.filter((item) => item.roleCode === 'esco')) {
  assert.strictEqual(testCase.actorRole, 'energy_service_company', `${testCase.testCaseCode} must use canonical DGI role`)
  assert.strictEqual(testCase.actorSubrole, 'DGI', `${testCase.testCaseCode} must use DGI subrole`)
  assert.match(testCase.applicationReference, /^23-DGI-(PRODAT|UTILTS)$/, `${testCase.testCaseCode} must use DGI application reference`)
  assert(!supplierBrpRelevantForRole(testCase.actorRole), `${testCase.testCaseCode} must not require supplier BRP`)
}

assert.strictEqual(normalizeActorRole('esco'), 'energy_service_company')
assert.strictEqual(normalizeActorRole('service_provider'), 'energy_service_company')
assert.strictEqual(roleCodeForActorRole('energy_service_company'), 'esco')
assert.strictEqual(normalizeActorSubrole(null, 'esco'), 'DGI')
assert.strictEqual(normalizeActorSubrole(null, 'supplier'), 'DDQ')
assert.strictEqual(applicationReferenceForActor({ actorRole: 'esco', actorSubrole: 'DGI', messageFamily: 'PRODAT' }), '23-DGI-PRODAT')
assert.strictEqual(applicationReferenceForActor({ actorRole: 'supplier', actorSubrole: 'DDQ', messageFamily: 'UTILTS' }), '23-DDQ-UTILTS')
assert.strictEqual(normalizeEnvironmentType('bilateral_test'), 'bilateral_test')

assert.strictEqual(
  getEdielAgtTestCaseByCode({ roleCode: 'esco', suite: 'PRODAT', testCaseCode: 'E3' }).applicationReference,
  '23-DGI-PRODAT',
  'E3 must resolve as DGI PRODAT'
)
assert.strictEqual(
  getEdielAgtTestCaseByCode({ roleCode: 'supplier', suite: 'PRODAT', testCaseCode: 'E3' }),
  null,
  'DGI E-cases must not resolve as supplier cases'
)

const productionBlocked = evaluateEdielProductionSendLock({
  id: 'prod-portal-party',
  company_id: '00000000-0000-4000-8000-000000000001',
  environment: 'production',
  direction: 'outbound',
  status: 'prepared',
  test_flag: 0,
  message_family: 'PRODAT',
  message_code: 'Z13',
  message_version: '26A',
  message_standard: 'edifact',
  raw_payload: "UNB+UNOC:3+SENDER:14+91100:14+260602:1200+1++++23-DGI-PRODAT'",
  sender_ediel_id: 'SENDER',
  receiver_ediel_id: '91100',
  receiver_email: 'ediel@example.test',
  application_reference: '23-DGI-PRODAT',
  communication_route_id: 'route-1',
})
assert(
  productionBlocked.issues.some((issue) => issue.code === 'ediel_portal_party_in_production'),
  'production PRODAT must block Edielportal/test party 91100'
)

const routeRegistrySource = fs.readFileSync(path.join(root, 'lib/ediel/core/routeRegistry.ts'), 'utf8')
assert(
  routeRegistrySource.includes('subaddressRequired && !receiverMessageSubAddress'),
  'route resolver must require receiver subaddress only when route says so'
)
assert(
  routeRegistrySource.includes("environment === 'production' && messageFamily === 'PRODAT' ? 'smime' : null"),
  'production PRODAT must default to S/MIME route mode'
)

const agtRuntimeSource = fs.readFileSync(path.join(root, 'lib/ediel/agtRuntime.ts'), 'utf8')
assert(
  agtRuntimeSource.includes('supplierBrpRelevantForRole(expectedActorRole)'),
  'AGT runtime must apply BRP checks only to supplier-relevant roles'
)
assert(
  agtRuntimeSource.includes("runtime.profile.subaddress_required === true") &&
    agtRuntimeSource.includes('agt_utilts_subaddress_should_be_blank'),
  'AGT UTILTS must reject receiver subaddress requirements'
)

console.log(JSON.stringify({
  ok: true,
  supplierProdat: codes(listEdielAgt2026Cases({ roleCode: 'supplier', suite: 'PRODAT' })),
  supplierUtilts: codes(listEdielAgt2026Cases({ roleCode: 'supplier', suite: 'UTILTS' })),
  dgiProdat: codes(listEdielAgt2026Cases({ roleCode: 'esco', suite: 'PRODAT' })),
  dgiUtilts: codes(listEdielAgt2026Cases({ roleCode: 'esco', suite: 'UTILTS' })),
  production91100Blocked: true,
  dryRunOnly: true,
}, null, 2))
