import { describe, expect, it } from 'vitest'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import { prodatInstallationNadSegment } from '@/lib/ediel/prodat/render/segments'
import { buildProdatLineSegments } from '@/lib/ediel/testing/tgtEdifact.part-3'
import { nowRefs, type TgtPortalCustomerData } from '@/lib/ediel/testing/tgtEdifact.part-1'
import type { EdielTgtExpectedStep } from '@/lib/ediel/testing/tgtRegistry'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'

// Literal expectations retain the old release contracts at the output boundary.
// No transport, database, portal or real customer is involved.
const context: ProdatEngineProductionContext = {
  code: 'Z18', bgmReference: 'DOC', transactionReference: 'CASE',
  senderEdielId: '12345', receiverEdielId: '54321', meterPointId: '735999999999999999',
  customerId: 'SYNTHETIC', customerName: 'Synthetic User', customerIdAgency: '89',
  customerCountry: 'SE', reasonForTransaction: 'S17', permissionId: 'PERMIT',
  permissionEndReason: '1', permissionTimestamp: '202609171230', permissionEndDate: '202611151330',
  siteAddress: 'Synthetic Road 1', siteCity: 'Test City', sitePostalCode: '12345',
  contractStartDate: '202610011230', contractEndDate: '202612011245',
}
function profile(permissionTimestamp: string | null = context.permissionTimestamp ?? null) {
  return buildProfiledProdatSegments({ context: { ...context, permissionTimestamp }, variant: 'V' }).segments
}
function tgt(permissionTimestamp: string | null = context.permissionTimestamp ?? null) {
  const portal: TgtPortalCustomerData = {
    source: 'missing_test_data', testCustomerLabel: 'synthetic',
    meteringPointId: context.meterPointId, agreementStartDateTime: '202610011230',
    agreementEndDateTime: '202612011245', annualEnergyUnit: 'KWH', meteringMethod: 'Z12',
    customerId: 'SYNTHETIC', customerName: 'Synthetic User', gridAreaId: 'TES', registers: [],
    permissionTimestamp, permissionEndDate: '202611151330', permissionId: 'PERMIT',
    siteAddress: 'Synthetic Road 1', siteCity: 'Test City', sitePostalCode: '12345',
  }
  return buildProdatLineSegments({ portalData: portal,
    step: { code: 'Z18', family: 'PRODAT', stepNo: 1, actor: 'gridex', direction: 'outbound', outcome: 'positive', title: 'Synthetic' } as EdielTgtExpectedStep,
    refs: nowRefs('E8', 1), transactionType: 'Z18V', mutation: {}, lineNo: 1,
    testSuite: 'PRODAT', roleCode: 'esco', testCaseCode: 'E8',
    systemTestContext: { companyId: 'tenant-A', actorEdielId: '12345', testPortalEdielId: '54321', testSuite: 'AGT', actorSettingId: null, actorName: null, senderSubaddress: null, testPortalName: null, testPortalEmail: null, defaultReceiverSubaddress: null, testBrpEdielId: null, testBrpName: null, settings: null },
  })
}

describe('Z18 release rendering contract', () => {
  for (const [name, render] of [['production', profile], ['E8 Systemtest', tgt]] as const) {
    it(`${name} preserves permission creation693 and termination164, without contract-date substitution`, () => {
      const segments = render()
      expect(segments.filter(s => s.startsWith('DTM+693:'))).toEqual(['DTM+693:202609171230:203'])
      expect(segments.filter(s => s.startsWith('DTM+164:'))).toEqual(['DTM+164:202611151330:203'])
      expect(segments.some(s => /^DTM\+(92|93|265):/.test(s))).toBe(false)
    })
    it(`${name} renders permission reference Z09, UD and no IT even with installation input`, () => {
      const segments = render()
      expect(segments.filter(s => s.startsWith('RFF+Z09:'))).toEqual(['RFF+Z09:PERMIT'])
      expect(segments.some(s => s.startsWith('NAD+UD+SYNTHETIC:'))).toBe(true)
      expect(segments.some(s => s.startsWith('NAD+IT'))).toBe(false)
    })
    it(`${name} does not fabricate the optional creation timestamp`, () => {
      const segments = render(null)
      expect(segments.some(s => s.startsWith('DTM+693:'))).toBe(false)
      expect(segments).toContain('DTM+164:202611151330:203')
    })
  }
})

describe('installation identity release rendering contract', () => {
  it.each(['', '   '])('keeps absent identity absent for %j, retaining the address', meterPointId => {
    expect(prodatInstallationNadSegment({ meterPointId, idAgency: '89', address: 'Synthetic Road 1', city: 'Test City', postalCode: '12345' }))
      .toBe('NAD+IT++++Synthetic Road 1+Test City++12345+SE')
  })
  it.each(['9', '89'] as const)('retains supplied identity and agency %s', idAgency => {
    expect(prodatInstallationNadSegment({ meterPointId: 'SITE:1+2', idAgency, address: 'A+B' }))
      .toBe(`NAD+IT+SITE?:1?+2::${idAgency}+++A?+B++++SE`)
  })
  it('defaults a real identity to agency9 without inventing identity', () => {
    expect(prodatInstallationNadSegment({ meterPointId: '735999999999999999' }))
      .toBe('NAD+IT+735999999999999999::9+++++++SE')
  })
  it('actual Z01 profile omits optional IT when its own identity is missing', () => {
    const result = buildProfiledProdatSegments({ context: { ...context, code: 'Z01', meterPointId: '', reasonForTransaction: 'E03' }, variant: 'L' })
    expect(result.segments).toContain('LIN+1')
    expect(result.segments.filter(s => s.startsWith('NAD+IT'))).toEqual([])
    expect(result.segments.some(s => /UNKNOWN|MISSING|PLACEHOLDER/.test(s))).toBe(false)
  })
})
