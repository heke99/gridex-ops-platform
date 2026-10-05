// masterplan: AT-Z14VH-ESCO
// Bounded historical profile evidence; caller facts are not admitted source,
// permission/grant authority, emitted ACKs or historical-delivery completion.
import { describe, expect, it } from 'vitest'
import { buildProdatMessage, type BuildProdatMessageInput } from '@/lib/ediel/prodat/buildProdat'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateProdatReportingPermission } from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import { validateProdatZ14Policy, z14DependentRules } from '@/lib/ediel/rulebook/prodatZ14Policy'
import { reportingZ14Selection } from './fixtures/prodat-reporting-permission'

const historicalEnd = '202609010000'
const evaluationUtcMs = Date.parse('2026-10-05T11:00:00Z')

function fixture() {
  const selection = reportingZ14Selection('S18')
  const own = selection.objects[0]
  if (own.code !== 'Z14' || own.term.kind === 'unknown') throw new Error('historical fixture requires an independent declaration')
  // The shared helper defaults to indefinite: declare bounded history before
  // building, and retain its independent request and fixed evaluation clock.
  own.term = { kind: 'bounded', endMinute: historicalEnd, declaration: own.term.declaration }
  selection.evaluationUtcMs = evaluationUtcMs
  const input: BuildProdatMessageInput = {
    dependentConditionFacts: { reportingPermission: selection },
    companyId: 'synthetic', role: 'energy_service_company', businessCode: 'Z14', transactionSubtype: 'VH',
    sender: { edielId: '54321' }, receiver: { edielId: '12345' }, environment: 'test',
    meteringPoint: { id: 'A', identityAgency: '9', gridArea: 'ABC' },
    codedAttributes: { Z13: 'S18', Z04: 'Z04', Z12: 'D', Z14: '8716867000030', Z22: 'E17', Z23: 'A74' },
    references: { LI: 'CASE', Z09: 'PERMISSION' },
    customer: { id: 'ID', name: 'User', idAgency: '89', country: 'SE' },
    installation: { address: 'Site', idAgency: '89' },
    dates: { messageDate: '202610051200', reportStartDate: '202606010000', reportEndDate: historicalEnd,
      observationLength: '15', observationLengthFormat: '806', permissionTimestamp: '202610051200' },
  }
  return { input, selection }
}

describe('Z14VH bounded historical profile and independent prior request', () => {
  it('joins the actual DGI builder, own historical fields, parser and reporting/source policies', () => {
    const { input } = fixture(), before = structuredClone(input)
    const built = buildProdatMessage(input), wire = tokenizeEdifact(built.rawEdifact)
    const parts = (tag: string, position: number) => segmentComposite(wire.segments.find(s => s.tag === tag)!, position, wire.una)
    expect(parts('UNB', 7)).toEqual(['23-DGI-PRODAT'])
    expect(parts('BGM', 1)).toEqual(['Z14'])
    expect(built.rawEdifact).toContain("CCI++Z13'CAV+S18'")
    expect(built.rawEdifact).toContain("CCI++Z23'CAV+A74'")
    expect(wire.segments.filter(s => s.tag === 'DTM').map(s => segmentComposite(s, 1, wire.una))).toEqual(expect.arrayContaining([
      ['90', '202606010000', '203'], ['91', historicalEnd, '203'], ['693', '202610051200', '203'],
    ]))
    expect(parseProdatMessage(built.rawEdifact).lineItems).toMatchObject([{
      meteringPointId: 'A', identityAgency: '9', customerId: 'ID', lineItemReference: 'CASE', permissionId: 'PERMISSION',
      reasonForTransaction: 'S18', permissionStatus: 'A74', energyProductId: '8716867000030',
      reportStartDate: '202606010000', reportEndDate: historicalEnd,
      historicalReportStartDate: '202606010000', historicalReportEndDate: historicalEnd,
      permissionTimestamp: '202610051200', permissionEndTimestamp: null, contractEndDate: null, isHistoricalMeteringRequest: true,
    }])
    const segments = wire.segments.map(s => s.raw)
    expect(validateProdatReportingPermission({ code: 'Z14', direction: 'outbound', rawSegments: segments, una: wire.una, facts: input.dependentConditionFacts })).toEqual([])
    expect(validateProdatZ14Policy({ code: 'Z14', rawSegments: segments, una: wire.una }, z14DependentRules())).toEqual([])
    expect(built.validation.ok).toBe(true)
    expect(built.reportingReadiness).toBe('unqualified')
    expect(input).toEqual(before)
    const policy = resolveCanonicalEdielPolicy({ family: 'PRODAT', messageCode: 'Z14', subtypeOrReasonCode: 'VH', direction: 'inbound',
      referenceDate: '2026-10-05', applicationReference: built.applicationReference, mode: 'catalog_evidence' })
    expect(policy.semantics).toMatchObject({ domainObject: 'historical_metering_data_permission', historical: true })
    expect(policy.businessResponses).toEqual([])
    expect(policy.ackRule).toMatchObject({ technicalAck: 'CONTRL', applicationAck: 'APERAK' })
  })

  it.each([
    { change: 'missing', end: null, issue: 'PRODAT_REPORTING_REQUIRED' },
    { change: 'changed', end: '202609020000', issue: 'PRODAT_REPORTING_VALUE_MISMATCH' },
  ])('refuses a $change bounded end against the independent historical declaration', ({ end, issue }) => {
    const { input, selection } = fixture(), before = structuredClone(selection)
    const wire = tokenizeEdifact(buildProdatMessage(input).rawEdifact), original = wire.segments.map(s => s.raw)
    const segments = original.flatMap(s => s === `DTM+91:${historicalEnd}:203` ? end === null ? [] : [`DTM+91:${end}:203`] : [s])
    expect(segments).not.toEqual(original)
    expect(validateProdatReportingPermission({ code: 'Z14', direction: 'outbound', rawSegments: segments, una: wire.una, facts: input.dependentConditionFacts }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: issue, blocking: true, fieldPath: 'DTM+91' })]))
    expect(() => buildProdatMessage({ ...input, dates: { ...input.dates, reportEndDate: end } })).toThrow(/Z14:321/)
    expect(selection).toEqual(before)
  })

  it('keeps valid S18 wire separate from an incompatible independently declared S17 request', () => {
    const { input, selection } = fixture(), wire = tokenizeEdifact(buildProdatMessage(input).rawEdifact)
    const segments = wire.segments.map(s => s.raw), own = selection.objects[0]
    if (own.code !== 'Z14' || own.requestAssociation.kind !== 'known') throw new Error('historical fixture requires its prior request')
    own.requestAssociation.reason = 'S17'
    expect(validateProdatZ14Policy({ code: 'Z14', rawSegments: segments, una: wire.una }, z14DependentRules())).toEqual([])
    expect(parseProdatMessage(segments.join("'") + "'").lineItems[0].reasonForTransaction).toBe('S18')
    expect(validateProdatReportingPermission({ code: 'Z14', direction: 'outbound', rawSegments: segments, una: wire.una, facts: input.dependentConditionFacts }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PRODAT_REPORTING_REQUEST_MISMATCH', blocking: true })]))
    expect(() => buildProdatMessage(input)).toThrow(/Z14:323/)
  })
})
