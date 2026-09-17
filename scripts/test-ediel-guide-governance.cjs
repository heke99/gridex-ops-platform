// Real source modules, isolated per test; no database, clock stub or network.
// Run: node --experimental-vm-modules --test scripts/test-ediel-guide-governance.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const { SourceTextModule } = require('node:vm')
const { test } = require('node:test')
const root = path.resolve(__dirname, '..')

async function runtime() {
  const modules = new Map()
  const entry = new SourceTextModule(`
    export * from '@/lib/ediel/rulebook/guideRegistry';
    export { selectRulebookVersion } from '@/lib/ediel/rulebook/versionSelector';
    export { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy';
  `, { identifier: path.join(root, 'lib/ediel/governance-test.ts') })
  await entry.link((specifier, parent) => {
    assert(specifier.startsWith('@/lib/ediel/') || specifier.startsWith('.'), `Unexpected dependency: ${specifier}`)
    const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(parent.identifier), specifier)
    const file = ['.ts', '/index.ts'].map(suffix => base + suffix).find(fs.existsSync)
    assert(file && file.startsWith(path.join(root, 'lib/ediel/')), 'Only local source modules are loaded')
    if (!modules.has(file)) modules.set(file, new SourceTextModule(stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'strip', sourceUrl: file }), { identifier: file }))
    return modules.get(file)
  })
  await entry.evaluate()
  return entry.namespace
}
const guide = { family: 'UTILTS', referenceDate: '2026-09-30', associationAssignedCode: 'E5SE5A' }
const policy = { ...guide, messageCode: 'S02', direction: 'inbound', applicationReference: '23-DDQ-S02-S' }
const invalidDates = ['2026-02-29', '2026-02-30', '2026-04-31', '2026-09-31', '2026-11-31', '2028-02-30', '2100-02-29', '0000-01-01', '2026-00-01', '2026-13-01', '2026-09-00', '2026-09-32', '', 'not-a-date']
const selectors = {
  direct: (api, date) => api.resolveAuthoritativeEdielGuide({ ...guide, referenceDate: date }),
  acceptance: (api, date) => api.resolveEdielGuideAcceptance({ ...guide, referenceDate: date }),
  inbound: (api, date) => api.resolveAcceptedInboundEdielGuides({ ...guide, referenceDate: date }),
  currentUtilts: (api, date) => api.getCurrentUtiltsGuide(date),
  version: (api, date) => api.selectRulebookVersion({ family: 'UTILTS', referenceDate: date }),
  policy: (api, date) => api.resolveCanonicalEdielPolicy({ ...policy, referenceDate: date }),
}
for (const [name, select] of Object.entries(selectors)) {
  for (const date of invalidDates.filter(date => name !== 'version' || date !== '')) {
    test(`${name}: impossible reference date ${JSON.stringify(date)} cannot select a guide`, async () => {
      const api = await runtime()
      assert.throws(() => select(api, date), /reference_date_(invalid|required)/)
    })
  }
  test(`${name}: leap days, month ends and prior date-prefix behavior remain valid`, async () => {
    const api = await runtime()
    for (const date of ['2026-02-28', '2026-04-30', '2026-09-30', '2026-10-01', '2028-02-29', '2400-02-29', ' 2026-10-01T23:30:00-12:00 ']) {
      assert.doesNotThrow(() => select(api, date), date)
    }
  })
}
for (const [label, mutate] of [
  ['registry append', list => list.push({ ...list[0], guideRevision: 'fabricated' })],
  ['registry reorder', list => list.reverse()],
  ['registry replacement', list => { list[0] = { ...list[0], effectiveFrom: '2000-01-01' } }],
  ['guide revision', list => { list[0].guideRevision = 'fabricated' }],
  ['guide validity', list => { list[0].effectiveTo = null }],
  ['activation array', list => list.find(row => row.activationDates)?.activationDates.push('2000-01-01')],
]) {
  test(`GOV-01: ${label} cannot alter source-controlled authority between requests`, async () => {
    const api = await runtime()
    const before = JSON.stringify(api.AUTHORITATIVE_EDIEL_GUIDES)
    assert.throws(() => mutate(api.AUTHORITATIVE_EDIEL_GUIDES), TypeError)
    assert.equal(JSON.stringify(api.AUTHORITATIVE_EDIEL_GUIDES), before)
    assert.equal(api.resolveAuthoritativeEdielGuide(guide).guideRevision, '25-A-3')
    assert.equal(api.resolveAuthoritativeEdielGuide({ ...guide, referenceDate: '2026-10-01' }).guideRevision, '25-A-4')
  })
}
test('GOV-01: returned guide cannot be used to modify the next caller', async () => {
  const api = await runtime()
  const result = api.resolveAuthoritativeEdielGuide(guide)
  assert(Object.isFrozen(result))
  assert.throws(() => { result.documentName = 'substituted-source' }, TypeError)
  assert.strictEqual(api.resolveAuthoritativeEdielGuide(guide), result)
})
test('GOV-03: APERAK retains the actual P/U source-family profiles, not a generic 16-B guide', async () => {
  const api = await runtime()
  for (const [source, association, revision, release] of [['PRODAT', 'E2SE6A', '26-A', '96A'], ['UTILTS', 'E5SE5A', '25-A-3', '04A'], ['UTILTS_ERR', 'E5SE5A', '25-A-3', '04A']]) {
    const selected = api.selectRulebookVersion({ family: 'APERAK', referenceDate: guide.referenceDate, sourceMessageFamily: source })
    assert.equal(selected.guideRevision, revision)
    assert.equal(selected.messageTypeToken, `APERAK:D:${release}:UN:${association}`)
  }
  assert.throws(() => api.selectRulebookVersion({ family: 'APERAK', referenceDate: guide.referenceDate }), /source_family_required/)
})
test('GOV-04/05: outbound stays current and inbound grace stops after the fourteenth day', async () => {
  const api = await runtime()
  for (const [date, current, inbound] of [
    ['2026-09-30', '25-A-3', ['25-A-3']],
    ['2026-10-01', '25-A-4', ['25-A-4', '25-A-3']],
    ['2026-10-14', '25-A-4', ['25-A-4', '25-A-3']],
    ['2026-10-15', '25-A-4', ['25-A-4']],
  ]) {
    const actual = api.resolveEdielGuideAcceptance({ ...guide, referenceDate: date })
    assert.deepEqual(actual.acceptedOutbound.map(row => row.guideRevision), [current])
    assert.deepEqual(actual.acceptedInbound.map(row => row.guideRevision), inbound)
  }
})
