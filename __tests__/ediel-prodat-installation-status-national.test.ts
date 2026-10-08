// masterplan: AT-Z03H-SUPPLIER, AT-Z04H-SUPPLIER
import { describe, expect, it, vi } from 'vitest'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { projectProdatDiagnostics, isQualifiedProdatApplicationError } from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import { PRODAT_26A_FIELD_MATRIX, canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { alphabets, characteristic, input, line, raw, type Parts } from './fixtures/prodat-register'
import { ownerSource as legacyOwnerSource, ownerSourceWithInstallationStatus, OWNER } from './helpers/sourceOwnerFixtures'
import { evidenceHash } from '@/lib/ediel/utilts/durableSourceDiscovery'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'

const database = vi.hoisted(() => ({
  from: vi.fn(() => { throw new Error('unexpected database read in finite installation-status validation') }),
  rpc: vi.fn(() => { throw new Error('unexpected database RPC in finite installation-status validation') }),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: database }))
import { resolveCanonicalRuntimeDecision } from '@/lib/ediel/core/runtimeDecision'

const legacyOptions: Parameters<typeof legacyOwnerSource>[0][] = [undefined, { readingDeclarations: true },
  ...(['test', 'production'] as const).flatMap(environment => [{ readingDeclarations: true as const, environment },
    ...(['Z11', 'Z12'] as const).flatMap(installationStatus => (['Z31', 'Z32'] as const)
      .map(settlementMethod => ({ readingDeclarations: true as const, environment, sourceCodes: { installationStatus, settlementMethod } })))])]

// Full returned-row hashes captured from the original constructor before extraction.
it('preserves every legacy full row, source wire and birth hash across old option variants', () => {
  expect(legacyOptions.map(options => evidenceHash(JSON.stringify(legacyOwnerSource(options))))).toEqual([
    "62422b726e9a6ec892d0b4ff8a6b17f6fd383422480c8ddf8240146212c89f2d",
    "70d37e773cac748c909557a052210ee39e6044e052ae629c537f25585b1a3829",
    "70d37e773cac748c909557a052210ee39e6044e052ae629c537f25585b1a3829",
    "93c32c477e6a784f8042df78e3de4e22ade51d9f99ece61e632596075212cbce",
    "b8b88ae0b6e5c13aa2908540544fb1c0935f6c9573c085dbce006dc1c51d5182",
    "5452e28a7d057a2e80a92be78559edb752f181d70b534d2f421df94437c90fd3",
    "3665e25ca6cbb1b137c7882beebe36418a8ee0abd0876f4f352598a62a3ffebb",
    "d1e7e52ed105566bea0d0024359970317ebcc60bc18079848c89d17d4be16211",
    "ebbd497c585513342cceb6966b9efc5b6e1488ab3f9e2b80beb4ab090b26d61b",
    "c85d2fb15793bd05592b160e0236844553a07fc65e47c3d462f22afc4b72b88d",
    "a9bb4453c93372b81359d2c3068cb1a6dbecc5545b0781a9d619c84855e7cfd3",
    "e2150e6e00314943265f46c1a1e60a0239d5e5044bbfcbb4be8ed03ae4106169"
])
})

describe('explicit installation-status fixture choice before source birth', () => {
  it.each(['Z11', 'Z12'] as const)('constructs only the selected %s physical status and its own birth hash', status => {
    for (const options of legacyOptions.filter(option => !option?.sourceCodes)) {
      const before = legacyOwnerSource(options), row = ownerSourceWithInstallationStatus(status, options)
      const expectedWire = before.raw_payload!.replace("CCI++Z07'CAV+E22'", `CCI++Z07'CAV+${status}'`)
      expect(expectedWire).not.toBe(before.raw_payload)
      expect(row.raw_payload).toBe(expectedWire)
      const born = (row.execution_context_snapshot as { receivedProdatContext: Record<string, unknown> }).receivedProdatContext
      const original = (before.execution_context_snapshot as { receivedProdatContext: Record<string, unknown> }).receivedProdatContext
      expect(born).toEqual({ ...original, payloadHash: evidenceHash(expectedWire) })
      expect(born.payloadHash).not.toBe(original.payloadHash)
      expect({ ...row, raw_payload: before.raw_payload, execution_context_snapshot: before.execution_context_snapshot }).toEqual(before)
      const wire = tokenizeEdifact(row.raw_payload!)
      const indices = wire.segments.flatMap((segment, index) => segment.tag === 'CCI' && segmentComposite(segment, 2, wire.una)[0] === 'Z07' ? [index] : [])
      expect(indices).toHaveLength(1)
      expect(wire.segments[indices[0] + 1].tag).toBe('CAV')
      expect(segmentComposite(wire.segments[indices[0] + 1], 1, wire.una)).toEqual([status])
    }
  })

  it.each(legacyOptions.filter(option => option?.sourceCodes).map(options => ({ options: options! })))('preserves the original explicit sourceCodes precedence: $options', ({ options }) => {
    const opposite = options.sourceCodes!.installationStatus === 'Z11' ? 'Z12' : 'Z11'
    expect(ownerSourceWithInstallationStatus(opposite, options)).toEqual(legacyOwnerSource(options))
  })

  it.each([undefined, null, '', 'E22', 'z12', 'Z12 ', ['Z12'], { toString: () => 'Z12' }])('refuses untyped non-national status %j before construction', status => {
    const invalid = status as unknown as Parameters<typeof ownerSourceWithInstallationStatus>[0]
    expect(() => ownerSourceWithInstallationStatus(invalid)).toThrow('installationStatus requires Z11 or Z12')
    expect(() => ownerSourceWithInstallationStatus(invalid, { readingDeclarations: true, sourceCodes: { installationStatus: 'Z12', settlementMethod: 'Z32' } })).toThrow('installationStatus requires Z11 or Z12')
  })

  it('the real full runtime rejects the original E22 wire with its own national field306 error', () => {
    const row = legacyOwnerSource(), before = structuredClone(row)
    const decision = resolveCanonicalRuntimeDecision(row)
    expect(decision.syntaxDecision).toBe('accepted')
    expect(decision.applicationDecision).toBe('rejected')
    const negative = decision.responsePlan.filter(plan => plan.family === 'APERAK' && plan.outcome === 'negative')
    expect(negative).toHaveLength(1)
    expect(negative[0].applicationErrors).toEqual([expect.objectContaining({ fieldCode: '306', ercCode: '42', text: 'Felaktigt Installationsstatus E22', referenceQualifier: 'Z07', referenceNumber: OWNER.external, lineItemReference: 'CASE-1' })])
    expect(negative[0].applicationErrors!.every(isQualifiedProdatApplicationError)).toBe(true)
    expect(row).toEqual(before)
    expect(database.from).not.toHaveBeenCalled()
    expect(database.rpc).not.toHaveBeenCalled()
  })

  it.each(['Z11', 'Z12'] as const)('the real full runtime accepts the explicitly constructed %s wire', status => {
    const row = ownerSourceWithInstallationStatus(status), before = structuredClone(row)
    const decision = resolveCanonicalRuntimeDecision(row)
    expect([decision.syntaxDecision, decision.applicationDecision, decision.functionalDecision]).toEqual(['accepted', 'accepted', 'accepted'])
    expect(decision.issues).toEqual([])
    expect(decision.responsePlan.some(plan => plan.family === 'APERAK' && plan.outcome === 'negative')).toBe(false)
    expect(row).toEqual(before)
    expect(database.from).not.toHaveBeenCalled()
    expect(database.rpc).not.toHaveBeenCalled()
  })
})

// P26.A r3 §2.6 p60 / frozen annex field306: Z11 disconnected, Z12 active.
// This calls the actual selected field consumer and national projection. The
// bounded field selection supplies no native admission, response or effects.
function validate(body: Parts[], code = 'Z04', subtype = 'H',
  direction: 'inbound' | 'outbound' = 'inbound', alphabet: readonly string[] = alphabets[0]) {
  const wire = input(raw(body, code, alphabet), code)
  const selected = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: code,
    subtypeOrReasonCode: subtype, direction, applicationReference: '23-DDQ-PRODAT',
    referenceDate: '2026-09-30', mode: 'catalog_evidence' })
  const policy = { ...selected, fieldRules: selected.fieldRules.filter(rule => 'fieldNumber' in rule && rule.fieldNumber === '306') }
  const issues = validateCanonicalPolicyFields({ policy, rawSegments: wire.rawSegments, una: wire.una })
    .filter(issue => issue.prodatDiagnostic?.kind === 'field' && issue.prodatDiagnostic.fieldNumber === '306')
  return { issues, national: projectProdatDiagnostics(issues) }
}

const object = (sequence: string, point: string, reason: string, status: string | null, register?: string): Parts[] =>
  [line(sequence, point, register, '9'), ...characteristic('Z13', reason),
    ...(status === null ? [] : characteristic('Z07', status)), ['RFF', ['LI', `CASE-${point}`]]]

describe('national installation-status code list at the canonical field consumer', () => {
  it('rejects physical E22 as ERC42 for its own object and line reference', () => {
    const result = validate([line('1', 'OWN-POINT', undefined, '9'),
      ...characteristic('Z13', 'Z25'), ...characteristic('Z07', 'E22'), ['RFF', ['LI', 'OWN-CASE']]])
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatchObject({ blocking: true, code: 'FIELD_MATRIX_CODE_LIST_INVALID',
      prodatDiagnostic: { kind: 'field', fieldNumber: '306', errorKind: 'invalid',
        component: { locator: 'CCI++Z07/CAV', cavComponent: 0 },
        occurrence: { scope: 'object', lineNumber: '1', objectId: 'OWN-POINT', identityAgency: '9', lineItemReference: 'OWN-CASE' } } })
    expect(result.national.applicationErrors).toHaveLength(1)
    expect(result.national.applicationErrors[0]).toMatchObject({ fieldCode: '306', ercCode: '42',
      text: 'Felaktigt Installationsstatus E22', referenceQualifier: 'Z07', referenceNumber: 'OWN-POINT', lineItemReference: 'OWN-CASE' })
    expect(isQualifiedProdatApplicationError(result.national.applicationErrors[0])).toBe(true)
    expect(result.national.disposition).toEqual({ kind: 'continue', reasons: [] })
  })

  for (const alphabet of alphabets) {
    it.each(['Z11', 'Z12'])(`accepts national status %s with UNA ${alphabet.join('')}`, status => {
      const result = validate(object('1', 'OWN:+?!POINT', 'Z25', status), 'Z04', 'H', 'inbound', alphabet)
      expect(result.issues).toEqual([])
      expect(result.national.applicationErrors).toEqual([])
    })
    it.each(['E22', 'E23', 'Z99', 'E:22'])(`rejects source value %s with UNA ${alphabet.join('')}`, status => {
      const result = validate(object('1', 'OWN:+?!POINT', 'Z25', status), 'Z04', 'H', 'inbound', alphabet)
      expect(result.national.applicationErrors).toHaveLength(1)
      expect(result.national.applicationErrors[0]).toMatchObject({ ercCode: '42', fieldCode: '306',
        text: `Felaktigt Installationsstatus ${status}`, referenceNumber: 'OWN:+?!POINT', lineItemReference: 'CASE-OWN:+?!POINT' })
      expect(isQualifiedProdatApplicationError(result.national.applicationErrors[0])).toBe(true)
    })
  }

  it.each([
    ['F', 'E64', true], ['G', 'E32', true], ['E', 'E34', false],
  ] as const)('Z06%s uses its own physical %s reason; absent required=%s', (subtype, reason, required) => {
    for (const direction of ['inbound', 'outbound'] as const) {
      const missing = validate(object('1', 'OWN', reason, null), 'Z06', subtype, direction)
      expect(missing.national.applicationErrors.map(error => [error.fieldCode, error.ercCode])).toEqual(required ? [['306', '41']] : [])
      for (const status of ['Z11', 'Z12']) {
        expect(validate(object('1', 'OWN', reason, status), 'Z06', subtype, direction).issues).toEqual([])
      }
      const invalid = validate(object('1', 'OWN', reason, 'E22'), 'Z06', subtype, direction)
      expect(invalid.national.applicationErrors).toHaveLength(1)
      expect(invalid.national.applicationErrors[0]).toMatchObject({ fieldCode: '306', ercCode: '42', text: 'Felaktigt Installationsstatus E22' })
    }
  })

  it.each([
    { pair: [] }, { pair: characteristic('Z070', 'E22') },
    { pair: [['CCI', '', 'Z07'], ['DTM', ['92', '202610010000', '203']], ['CAV', 'E22']] },
  ] satisfies { pair: Parts[] }[])('preserves a missing mandatory status instead of borrowing unrelated CAV: $pair', ({ pair }) => {
    const result = validate([line('1', 'OWN', undefined, '9'), ...characteristic('Z13', 'Z25'), ...pair, ['RFF', ['LI', 'OWN-CASE']]])
    expect(result.national.applicationErrors).toHaveLength(1)
    expect(result.national.applicationErrors[0]).toMatchObject({ fieldCode: '306', ercCode: '41', text: 'Installationsstatus saknas' })
  })

  it('keeps invalid sibling objects separate and their national references source-owned', () => {
    const result = validate([...object('1', 'BAD-A', 'Z25', 'E22'), ...object('2', 'HEALTHY', 'Z25', 'Z12'),
      ...object('3', 'BAD-C', 'Z25', 'E23')])
    expect(result.national.applicationErrors.map(error => [error.referenceNumber, error.lineItemReference, error.text])).toEqual([
      ['BAD-A', 'CASE-BAD-A', 'Felaktigt Installationsstatus E22'], ['BAD-C', 'CASE-BAD-C', 'Felaktigt Installationsstatus E23'],
    ])
    expect(result.national.applicationErrors.every(isQualifiedProdatApplicationError)).toBe(true)
  })

  it('cannot borrow a missing first-register status from register two', () => {
    const result = validate([...object('1', 'OWN', 'Z25', null, '1'), line('2', 'OWN', '2', '9'), ...characteristic('Z07', 'Z12')])
    expect(result.national.applicationErrors).toHaveLength(1)
    expect(result.national.applicationErrors[0]).toMatchObject({ ercCode: '41', fieldCode: '306',
      prodatOccurrence: { lineNumber: '1', registerPosition: 1, objectId: 'OWN' } })
  })

  it('preserves inbound gray-field ignoring before code-list validation', () => {
    const result = validate(object('1', 'OWN', 'Z22', 'E22'), 'Z01', 'L')
    expect(result.issues).toEqual([])
    expect(result.national.applicationErrors).toEqual([])
  })

  it('preserves outbound prohibition for an inapplicable status, even if its value is national', () => {
    const result = validate(object('1', 'OWN', 'Z22', 'Z12'), 'Z01', 'L', 'outbound')
    expect(result.issues.some(issue => issue.code === 'FIELD_MATRIX_FORBIDDEN_FIELD_PRESENT' && issue.blocking)).toBe(true)
  })

  it('cannot change national validation by mutating published or copied code-list arrays', () => {
    const row = PRODAT_26A_FIELD_MATRIX.find(candidate => candidate.fieldNumber === '306')!
    expect(Reflect.set(row.allowedValues!, '0', 'E22')).toBe(false)
    const copied = canonicalProdat26AFieldRules('Z04').find(rule => rule.fieldNumber === '306')!
    copied.allowedValues!.push('E22')
    const body = object('1', 'OWN', 'Z25', 'E22'), before = structuredClone(body)
    expect(validate(body).national.applicationErrors[0]).toMatchObject({ fieldCode: '306', ercCode: '42' })
    expect(body).toEqual(before)
  })
})
