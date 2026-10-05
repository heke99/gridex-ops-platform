// masterplan: AT-Z14V-ESCO
// Real profile/field consumers with the existing independent request fixture.
// Catalog facts are not native grant, admitted inbound or projection authority.
import { describe, expect, it } from 'vitest'
import { buildProdatMessage, type BuildProdatMessageInput } from '@/lib/ediel/prodat/buildProdat'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateProdatReportingPermission } from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import { validateProdatZ14Policy, z14DependentRules } from '@/lib/ediel/rulebook/prodatZ14Policy'
import { validateProdatPermissionMessage } from '@/lib/ediel/testing/prodatPermissionEngine'
import { permissionAckMessage } from './fixtures/prodat-permission-ack'
import { reportingZ14Selection } from './fixtures/prodat-reporting-permission'

function fixture(): BuildProdatMessageInput {
  // Reuse the declared independent original request used by the retained
  // Z14 builder and reporting suites; response bytes cannot create its scope.
  return { dependentConditionFacts: { reportingPermission: reportingZ14Selection() },
    companyId: 'synthetic', role: 'energy_service_company', businessCode: 'Z14', transactionSubtype: 'V',
    sender: { edielId: '54321' }, receiver: { edielId: '12345' }, environment: 'test',
    meteringPoint: { id: 'A', gridArea: 'ABC' },
    codedAttributes: { Z13: 'S17', Z04: 'Z04', Z12: 'D', Z14: '8716867000030', Z22: 'E17', Z23: 'A74' },
    references: { LI: 'CASE', Z09: 'PERMISSION' }, customer: { id: 'ID', name: 'User', idAgency: '89', country: 'SE' },
    installation: { address: 'Site', idAgency: '89' },
    dates: { reportStartDate: '202610010000', observationLength: '15', observationLengthFormat: '806', permissionTimestamp: '202609191200' },
  }
}

describe('Z14V profile and independent object/reporting limits', () => {
  it('joins the real positive builder, own fields and parser while retaining the request scope', () => {
    const input = fixture(), before = structuredClone(input), built = buildProdatMessage(input), wire = tokenizeEdifact(built.rawEdifact)
    const parts = (tag: string, position: number) => segmentComposite(wire.segments.find(s => s.tag === tag)!, position, wire.una)
    expect(parts('UNB', 7)).toEqual(['23-DGI-PRODAT']); expect(parts('BGM', 1)).toEqual(['Z14'])
    expect(built.rawEdifact).toContain("CCI++Z13'CAV+S17'")
    expect(built.rawEdifact).toContain("CCI++Z23'CAV+A74'")
    expect(parseProdatMessage(built.rawEdifact).lineItems[0]).toMatchObject({ customerId: 'ID', permissionId: 'PERMISSION' })
    expect(built.validation.ok).toBe(true)
    const segments = wire.segments.map(s => s.raw)
    expect(validateProdatReportingPermission({ code: 'Z14', rawSegments: segments, una: wire.una, facts: input.dependentConditionFacts })).toEqual([])
    expect(validateProdatZ14Policy({ code: 'Z14', rawSegments: segments, una: wire.una }, z14DependentRules())).toEqual([])
    expect(input).toEqual(before)
    const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z14', subtypeOrReasonCode: 'V', direction: 'inbound', referenceDate: '2026-10-05', applicationReference: built.applicationReference, mode: 'catalog_evidence' })
    expect(policy.businessResponses).toEqual([])
    expect(policy.ackRule).toMatchObject({ technicalAck: 'CONTRL', applicationAck: 'APERAK' })
    expect(policy.semantics.domainObject).toBe('metering_data_permission')
  })
  it.each(['LI', 'customer', 'point', 'end', 'purpose'] as const)('refuses changed %s on the built positive response against its prior request', change => {
    const input = fixture(), built = buildProdatMessage(input), wire = tokenizeEdifact(built.rawEdifact), original = wire.segments.map(s => s.raw)
    let segments = original.map(s => change === 'LI' && s === 'RFF+LI:CASE' ? 'RFF+LI:OTHER' : change === 'customer' && s.startsWith('NAD+UD+') ? s.replace('ID::89', 'OTHER::89') : change === 'point' && s.startsWith('LIN+1++A') ? s.replace('++A', '++OTHER') : s)
    if (change === 'end') segments = segments.flatMap(s => s.startsWith('LIN+') ? [s, 'DTM+91:202701010000:203'] : [s])
    if (change === 'purpose') segments = segments.flatMap(s => s === 'RFF+LI:CASE' ? ['CCI++Z24', 'CAV+B72', s] : [s])
    expect(segments).not.toEqual(original)
    expect(validateProdatReportingPermission({ code: 'Z14', rawSegments: segments, una: wire.una, facts: input.dependentConditionFacts }).some(i => i.blocking)).toBe(true)
  })
  it.each(['permission', 'method', 'start', 'product'] as const)('refuses missing own %s at the actual positive builder', field => {
    const input = fixture()
    if (field === 'permission') input.references!.Z09 = null
    if (field === 'method') input.codedAttributes!.Z04 = null
    if (field === 'start') input.dates!.reportStartDate = null
    if (field === 'product') input.codedAttributes!.Z14 = null
    expect(() => buildProdatMessage(input)).toThrow()
  })
  it('keeps A74 approval and source-valid Z14N denial distinct at the real permission field consumer', () => {
    expect(validateProdatPermissionMessage({ message: permissionAckMessage('Z14', 'S17', 'A74', null) }).outcome).toBe('positive')
    const invalid = validateProdatPermissionMessage({ message: permissionAckMessage('Z14', 'S17', 'A13', null) })
    expect(invalid.applicationErrors).toEqual(expect.arrayContaining([expect.objectContaining({ fieldCode: '322', ercCode: '42' })]))
    expect(validateProdatPermissionMessage({ message: permissionAckMessage('Z14', 'Z96', 'A13', null) }).outcome).toBe('positive')
  })
})
