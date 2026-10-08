// masterplan: AT-Z03H-SUPPLIER, AT-Z04H-SUPPLIER
import { describe, expect, it } from 'vitest'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { projectProdatDiagnostics, isQualifiedProdatApplicationError } from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import { characteristic, input, line, raw, type Parts } from './fixtures/prodat-register'

// P26.A r3 §2.6 p60 / frozen annex field306: Z11 disconnected, Z12 active.
// This calls the actual selected field consumer and national projection. The
// bounded field selection supplies no native admission, response or effects.
function validate(body: Parts[], code = 'Z04', subtype = 'H') {
  const wire = input(raw(body, code), code)
  const selected = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: code,
    subtypeOrReasonCode: subtype, direction: 'inbound', applicationReference: '23-DDQ-PRODAT',
    referenceDate: '2026-09-30', mode: 'catalog_evidence' })
  const policy = { ...selected, fieldRules: selected.fieldRules.filter(rule => rule.fieldNumber === '306') }
  const issues = validateCanonicalPolicyFields({ policy, rawSegments: wire.rawSegments, una: wire.una })
    .filter(issue => issue.prodatDiagnostic?.kind === 'field' && issue.prodatDiagnostic.fieldNumber === '306')
  return { issues, national: projectProdatDiagnostics(issues) }
}

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
})
