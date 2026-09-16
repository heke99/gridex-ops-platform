// Tests the real policy and evidence modules; only the database boundary is fake.
// Run: node --experimental-vm-modules --test scripts/test-ediel-rule-pack-source-identity.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { stripTypeScriptTypes } = require('node:module')
const { SourceTextModule, SyntheticModule } = require('node:vm')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
async function resolver(row, error = null) {
  const modules = new Map()
  const calls = []
  const service = new SyntheticModule(['supabaseService'], function () {
    this.setExport('supabaseService', { rpc: async (...args) => {
      calls.push(args)
      return { data: row === null ? [] : [row], error }
    } })
  })
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    assert(file.startsWith(path.join(root, 'lib/ediel') + path.sep), 'Only real local Ediel modules are loaded')
    const module = new SourceTextModule(stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), {
      mode: 'strip', sourceUrl: file,
    }), { identifier: file })
    modules.set(file, module)
    return module
  }
  const entry = load(path.join(root, 'lib/ediel/rulebook/canonicalRulePackRegistry.ts'))
  await entry.link((specifier, parent) => {
    if (specifier === '@/lib/supabase/service') return service
    assert(specifier.startsWith('@/lib/ediel/') || specifier.startsWith('.'), `Unexpected dependency: ${specifier}`)
    const filename = specifier.startsWith('@/')
      ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(parent.identifier), specifier)
    for (const suffix of ['.ts', '/index.ts']) {
      if (fs.existsSync(filename + suffix)) return load(filename + suffix)
    }
    throw new Error(`Missing local Ediel module: ${filename}`)
  })
  await entry.evaluate()
  return { resolve: entry.namespace.resolveCanonicalRulePack, calls }
}
function evidence(code = 'E66', revision = '3', overrides = {}, profileOverrides = {}) {
  const version = `25-A-${revision}`
  return {
    rule_pack_id: '11111111-1111-4111-8111-111111111111',
    message_profile_id: '22222222-2222-4222-8222-222222222222',
    market: 'electricity', family: 'UTILTS', guide_version: version, guide_revision: revision,
    unh_association_code: 'E5SE5A',
    valid_from: revision === '3' ? '2025-06-01' : '2026-10-01',
    valid_to: revision === '3' ? '2026-09-30' : null,
    source_document: `UTILTS ${version}`, source_hash: 'a'.repeat(64), field_matrix_version: version,
    profile_key: `UTILTS:${code}:E5SE5A:${revision}`, business_process: 'metering_values', phase: null,
    parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true,
    ...overrides,
    profile: { family: 'UTILTS', messageCode: code, guideVersion: version, guideRevision: revision, ...profileOverrides },
  }
}
const input = { family: 'UTILTS', messageCode: 'E66', direction: 'inbound',
  businessDate: '2026-09-30', applicationReference: '23-DDQ-E66-S', requireBuilder: false }

for (const [date, revision] of [['2026-09-30', '3'], ['2026-10-01', '4']]) {
  test(`selected E66 reference reaches evidence lookup on ${date}`, async () => {
    const { resolve, calls } = await resolver(evidence('E66', revision))
    const result = await resolve({ ...input, businessDate: date })
    assert.equal(result.guideVersion, `25-A-${revision}`)
    assert.equal(result.profile.applicationReference, input.applicationReference)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'resolve_canonical_ediel_rule_pack')
    assert.equal(calls[0][1].p_business_date, date)
    assert.deepEqual(Object.keys(calls[0][1]).sort(), [
      'p_market', 'p_family', 'p_message_code', 'p_transaction_subtype', 'p_direction', 'p_business_date',
    ].sort(), 'The existing RPC contract stays unchanged')
  })
}
for (const target of ['E66', 'S02']) {
  test(`E73 retains its explicit ${target} target without local role inference`, async () => {
    const { resolve } = await resolver(evidence('E73'))
    const ref = `23-DDQ-${target}-S`
    const result = await resolve({ ...input, messageCode: 'E73', direction: 'outbound',
      applicationReference: ref, requestedMessageCode: target })
    assert.equal(result.profile.applicationReference, ref)
  })
}
for (const [label, change, code] of [
  ['missing E66 reference', { applicationReference: null }, 'canonical_ediel_application_reference_required'],
  ['missing even single-valued inbound S02 reference', { messageCode: 'S02', applicationReference: null }, 'canonical_ediel_application_reference_required'],
  ['invalid selected reference', { applicationReference: '23-DDQ-S04-S' }, 'utilts_application_reference_not_allowed'],
  ['conflicting request target', { messageCode: 'E73', direction: 'outbound', requestedMessageCode: 'S02' }, 'utilts_application_reference_not_allowed:S02:23-DDQ-E66-S'],
]) {
  test(`${label} is rejected before any database lookup`, async () => {
    const { resolve, calls } = await resolver(evidence())
    await assert.rejects(resolve({ ...input, ...change }), new RegExp(code))
    assert.equal(calls.length, 0)
  })
}
// S02 used to reach the evidence comparison even before the E66 reference fix.
const s02 = { ...input, messageCode: 'S02', applicationReference: '23-DDQ-S02-S' }
for (const [label, override, profileOverride, code] of [
  ['wrong revision despite correct version', { guide_revision: '4' }, {}, 'canonical_rule_pack_evidence_guide_revision_mismatch'],
  ['association code pretending to be a guide version', { guide_version: 'E5SE5A' }, {}, 'canonical_rule_pack_evidence_guide_mismatch'],
  ['wrong version despite matching revision field', { guide_version: '25-A-4', guide_revision: '25-A-3' }, {}, 'canonical_rule_pack_evidence_guide_mismatch'],
  ['missing revision', { guide_revision: '' }, {}, 'canonical_rule_pack_result_missing:guide_revision'],
  ['wrong profile version', {}, { guideVersion: '25-A-4' }, 'canonical_rule_pack_evidence_profile_guide_mismatch'],
  ['wrong profile revision', {}, { guideRevision: '4' }, 'canonical_rule_pack_evidence_profile_revision_mismatch'],
  ['missing profile revision', {}, { guideRevision: null }, 'canonical_rule_pack_evidence_profile_field_missing:guideRevision'],
  ['foreign message profile', {}, { messageCode: 'E31' }, 'canonical_rule_pack_evidence_message_code_mismatch'],
  ['expired evidence', { valid_to: '2026-09-29' }, {}, 'canonical_rule_pack_evidence_date_mismatch'],
  ['validator not ready', { validator_ready: false }, {}, 'canonical_rule_pack_evidence_runtime_incomplete'],
  ['state machine not ready', { state_machine_ready: false }, {}, 'canonical_rule_pack_evidence_state_machine_not_ready'],
]) {
  test(`${label} cannot become canonical evidence`, async () => {
    const { resolve, calls } = await resolver(evidence('S02', '3', override, profileOverride))
    await assert.rejects(resolve(s02), new RegExp(code))
    assert.equal(calls.length, 1)
  })
}
test('correct S02 evidence keeps its source-selected semantic profile', async () => {
  const { resolve } = await resolver(evidence('S02'))
  const result = await resolve(s02)
  assert.equal(result.family, 'UTILTS')
  assert.equal(result.guideVersion, '25-A-3')
  assert.equal(result.profile.applicationReference, s02.applicationReference)
  assert.notEqual(result.profileKey, 'UTILTS:S02:E5SE5A:3')
})
test('database errors are not replaced by a locally invented activation', async () => {
  const { resolve } = await resolver(evidence('S02'), { message: 'test-db-error' })
  await assert.rejects(resolve(s02), /canonical_rule_pack_evidence_resolution_failed:test-db-error/)
})
test('no activated evidence remains blocking', async () => {
  const { resolve } = await resolver(null)
  await assert.rejects(resolve(s02), /canonical_rule_pack_evidence_count:0/)
})
test('PRODAT evidence keeps its existing technical-versus-semantic identity contract', async () => {
  const row = { ...evidence(), family: 'PRODAT', guide_version: '26.A', guide_revision: '3',
    unh_association_code: 'E2SE6A', valid_from: '2026-04-01', valid_to: null,
    profile_key: 'PRODAT:Z01:L:26.A:r3', profile: { family: 'PRODAT', messageCode: 'Z01',
      transactionSubtype: 'L', canonicalDirection: 'outbound', reasonForTransaction: 'Z22' } }
  const { resolve } = await resolver(row)
  const result = await resolve({ family: 'PRODAT', messageCode: 'Z01', transactionSubtype: 'L',
    direction: 'outbound', businessDate: '2026-09-30' })
  assert.equal(result.profileKey, 'prodat_z01_customer_identity_request')
  assert.equal(result.businessProcess, 'customer_masterdata')
})
