// masterplan: AT-Z03H-SUPPLIER, AT-Z04H-SUPPLIER
import { describe, expect, it } from 'vitest'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { projectProdatDiagnostics, isQualifiedProdatApplicationError } from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import { PRODAT_26A_FIELD_MATRIX, canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { alphabets, characteristic, input, line, raw, type Parts } from './fixtures/prodat-register'

// P26.A r3 §2.6 p60 / frozen annex field306: Z11 disconnected, Z12 active.
// This calls the actual selected field consumer and national projection. The
// bounded field selection supplies no native admission, response or effects.
function validate(body: Parts[], code = 'Z04', subtype = 'H',
  direction: 'inbound' | 'outbound' = 'inbound', alphabet: readonly string[] = alphabets[0]) {
  const wire = input(raw(body, code, alphabet), code)
  const selected = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: code,
    subtypeOrReasonCode: subtype, direction, applicationReference: '23-DDQ-PRODAT',
    referenceDate: '2026-09-30', mode: 'catalog_evidence' })
  const policy = { ...selected, fieldRules: selected.fieldRules.filter(rule => rule.fieldNumber === '306') }
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
