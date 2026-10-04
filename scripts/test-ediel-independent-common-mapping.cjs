// SC-072: a real shared builder/decoder mapping fault must fail an independent
// physical-wire oracle even while its own roundtrip and service syntax pass.
// Source: T24.A rev6, section4.2 pp24-25, immutable original SHA below.
// Run: node --experimental-vm-modules --test scripts/test-ediel-independent-common-mapping.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { stripTypeScriptTypes } = require('node:module')
const { SourceTextModule } = require('node:vm')
const { test, after } = require('node:test')
const { sourceRuntimeBoundary, assertNoSourceBoundaryAttempts } = require('./helpers/ediel-source-manifest-vm.cjs')
const root = path.resolve(__dirname, '..')
const codecFile = path.join(root, 'lib/ediel/core/edifactEnvelopeCodec.ts')
const authority = Object.freeze({ document: 'T', revision: '24-A-6', section: '4.2', pages: [24,25],
  originalSha256: '5204d4514774b04b8eedb039e1f4799ed447c7fef14554577935e2d7bd93f951' })
// This literal is independently transcribed from the source's ordered UNB
// composites, not generated or decoded by any product builder/validator.
const expectedUnb = 'UNB+UNOC:3+43210:ZZ+76543:ZZ+260920:1200+INDEPENDENT-I++23-DDQ-PRODAT++++1'
const originalFixtureSha256 = createHash('sha256').update(expectedUnb).digest('hex')

async function loadRuntime(fault) {
  const modules = new Map()
  const entry = new SourceTextModule(`
    export { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec';
    export { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator';
  `, { identifier: path.join(root, 'lib/ediel/independent-mapping-test.ts') })
  await entry.link((specifier, parent) => {
    const boundary = sourceRuntimeBoundary(specifier, modules, parent)
    if (boundary) return boundary
    assert(specifier.startsWith('@/lib/ediel/') || specifier.startsWith('.'), `Unexpected dependency: ${specifier}`)
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(parent.identifier), specifier)
    const file = ['.ts', '/index.ts'].map(suffix => base + suffix).find(fs.existsSync)
    assert(file && file.startsWith(path.join(root, 'lib/ediel/')), 'Only authentic local source modules')
    if (!modules.has(file)) {
      let source = fs.readFileSync(file, 'utf8')
      if (file === codecFile && fault) {
        const [before, after] = fault
        assert.equal(source.split(before).length - 1, 1, 'The declared real shared-map fault must target exactly one original')
        source = source.replace(before, after)
      }
      modules.set(file, new SourceTextModule(stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: file }), { identifier: file }))
    }
    return modules.get(file)
  })
  await entry.evaluate()
  return entry.namespace
}
function input() {
  return { sender: '43210', receiver: '76543', interchangeReference: 'INDEPENDENT-I',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: false, environment: 'test',
    timeZone: 'UTC', createdAt: new Date('2026-09-20T12:00:00.000Z'), messages: [{
      messageReference: 'INDEPENDENT-M', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
      businessSegments: ['BGM+Z03+INDEPENDENT-D+9+AB',
        'DTM+137:202609201200:203', 'LIN+1++735123456789012345:::9'] }] }
}
function literalUnb(wire) {
  // This bounded lexical oracle uses only the fixed default alphabet and
  // simple fixture data; it imports neither the codec nor its UNB position map.
  assert(wire.startsWith("UNA:+.? '"))
  const unb = wire.slice(9).split("'").find(segment => segment.startsWith('UNB+'))
  assert.equal(typeof unb, 'string')
  return unb
}
function independentSourceOracle(wire) {
  assert.equal(createHash('sha256').update(expectedUnb).digest('hex'), originalFixtureSha256, 'The reference original must not be repaired to fit output')
  assert.equal(literalUnb(wire), expectedUnb, 'T24.A6 section4.2 literal ordered sender/recipient/0031/0035 oracle')
}
function ownChecks(api, wire) {
  const decoded = api.EdifactEnvelopeCodec.decode(wire)
  assert.equal(decoded.sender, input().sender)
  assert.equal(decoded.receiver, input().receiver)
  assert.equal(decoded.acknowledgementRequest, null)
  assert.equal(decoded.testIndicator, '1')
  assert.equal(decoded.environment, 'test')
  const syntax = api.validateEdifactSyntax({ raw_payload: wire, message_family: 'PRODAT',
    message_code: 'Z03', syntax_check_status: 'ok', status: 'received' })
  assert.equal(syntax.ok, true, JSON.stringify(syntax.issues))
}
after(() => assertNoSourceBoundaryAttempts())
test('SC-072 a correct independent UNB cannot qualify a BGM-only body against full 97A grammar', async () => {
  const api = await loadRuntime()
  const fixture = input()
  fixture.messages[0].businessSegments = ['BGM+Z03+INDEPENDENT-D+9+AB']
  const wire = api.EdifactEnvelopeCodec.encode(fixture)
  independentSourceOracle(wire)
  const syntax = api.validateEdifactSyntax({ raw_payload: wire, message_family: 'PRODAT',
    message_code: 'Z03', syntax_check_status: 'ok', status: 'received' })
  assert.equal(syntax.ok, false)
  assert(syntax.issues.some(issue => issue.code === 'UNSM_MESSAGE_STRUCTURE_INVALID'))
})
test('SC-072 normal authentic codec passes own checks and the independent revision-correct literal oracle', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'docs/ediel/masterplan-v2/registers/source_manifest.json'),'utf8'))
  assert.equal(manifest.find(source => source.id === authority.document).sha256, authority.originalSha256)
  const api = await loadRuntime(), wire = api.EdifactEnvelopeCodec.encode(input())
  ownChecks(api, wire)
  independentSourceOracle(wire)
})
for (const [label, fault] of [
  ['shared sender/recipient positions', ['  SENDER: 2,\n  RECEIVER: 3,','  SENDER: 3,\n  RECEIVER: 2,']],
  ['shared ACK-request/test-indicator positions', ['  ACK_REQUEST: 9,\n  COMMUNICATIONS_AGREEMENT: 10,\n  TEST_INDICATOR: 11,','  ACK_REQUEST: 11,\n  COMMUNICATIONS_AGREEMENT: 10,\n  TEST_INDICATOR: 9,']],
]) test(`SC-072 ${label}: authentic own roundtrip and syntax stay green, independent source oracle detects the real defect`, async () => {
  const api = await loadRuntime(fault), wire = api.EdifactEnvelopeCodec.encode(input())
  ownChecks(api, wire)
  assert.notEqual(literalUnb(wire), expectedUnb)
  assert.throws(() => independentSourceOracle(wire), { name: 'AssertionError' })
})
