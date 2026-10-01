import { describe, expect, it } from 'vitest'
import { validateProdatProfile } from '@/lib/ediel/prodat/profiles'
import { validateProdatContext } from '@/lib/ediel/prodat/render/validate'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'

const base: ProdatEngineProductionContext = {
  code: 'Z13', bgmReference:'REQUEST', transactionReference:'CASE', senderEdielId:'12345', receiverEdielId:'54321',
  meterPointId:'', customerId:'5590000000', customerIdCodeListQualifier:'SE1', customerName:'Synthetic legal customer',
  reasonForTransaction:'S17', installationDirection:'E17', permissionPurpose:'B72', reportingFrequency:'D',
  energyProductId:'8716867000030', startDate:'2026-09-29', customerCountry:'SE',
}

describe('P26.A field209 and physical LIN in identityless permission requests', () => {
  it.each(['V', 'VH'])('Z13%s does not require an object ID in either real builder-input gate', subtype => {
    const context = { ...base, reasonForTransaction:subtype === 'VH' ? 'S18' : 'S17',
      permissionEndDate:subtype === 'VH' ? '2026-09-29' : null }
    expect(validateProdatProfile({code:'Z13',subtype,version:'26A',context}).issues
      .filter(issue => issue.code.includes('meter') || issue.code.includes('point'))).toEqual([])
    expect(validateProdatContext(context).filter(issue => issue.code === 'prodat_engine_metering_point_missing')).toEqual([])
    const rendered = buildProfiledProdatSegments({context,variant:subtype,mode:'test',generatedAt:new Date('2026-09-30T12:00:00Z')})
    expect(rendered.segments.filter(segment => segment.startsWith('LIN'))).toEqual(['LIN+1'])
    expect(rendered.issues.filter(issue => issue.code === 'prodat_engine_metering_point_missing')).toEqual([])
  })

  it('a source-qualified Z14N omits physical identity; positive Z14 still needs it', () => {
    const negative = {...base,code:'Z14' as const,reasonForTransaction:'Z96',permissionStatus:'A76'}
    expect(validateProdatProfile({code:'Z14',subtype:'N',version:'26A',context:negative}).issues
      .filter(issue => issue.code.includes('meter') || issue.code.includes('point') || issue.code.includes('customer'))).toEqual([])
    expect(validateProdatContext(negative).filter(issue => issue.code === 'prodat_engine_metering_point_missing')).toEqual([])
    expect(validateProdatContext({...negative,reasonForTransaction:'S17'}).some(issue => issue.code === 'prodat_engine_metering_point_missing')).toBe(true)
  })
})
