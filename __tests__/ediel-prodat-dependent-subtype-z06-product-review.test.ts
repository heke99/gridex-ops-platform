import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { prodatProductMarket } from '@/lib/ediel/rulebook/prodatProductScope'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { canonicalProdat26AFieldRules } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { alphabets, characteristic, input, line, raw } from './fixtures/prodat-register'

const elReferences = ['23-DDQ-PRODAT', '23-DGI-PRODAT'] as const
const isProductIssue = (issue: {scope?: string; description: string}) => issue.scope === 'prodat_dependent' && issue.description.includes('Z06:242')
const policy = resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z06',subtypeOrReasonCode:'F',direction:'outbound',referenceDate:'2026-09-18',mode:'catalog_evidence'})

describe('PR334 review: market evidence is distinct from process permission', () => {
  it('retains both EL references in field311 and the narrower Z06 process contracts', () => {
    const fields = JSON.parse(readFileSync('docs/ediel/masterplan-v2/registers/prodat_fields.json','utf8')) as {field:string; notes:string}[]
    const note = fields.find(row => row.field === '311')!.notes
    for (const reference of [...elReferences,'27-DDQ-PRODAT']) expect(note).toContain(reference)
    const cases = JSON.parse(readFileSync('docs/ediel/masterplan-v2/registers/prodat_message_cases.json','utf8')) as {id:string;application_reference:string}[]
    for (const subtype of ['E','F','G']) expect(cases.find(row => row.id === `CASE-Z06${subtype}-SUPPLIER`)?.application_reference).toBe('23-DDQ-PRODAT')
  })
  for (const alphabet of alphabets) {
    for (const reference of elReferences) for (const reason of ['E64','E32','E34']) {
      it(`${alphabet.join('')}/${reference}/${reason}: accepts EL evidence without waiving the independent process rule`, () => {
        const payload = raw([line('1','A'),...characteristic('Z13',reason),...(reason === 'E34' ? [] : characteristic('Z14','L639Q',3))],'Z06',alphabet).replace('23-DDQ-PRODAT',reference)
        const wire = input(payload,'Z06')
        expect(prodatProductMarket({...wire,applicationReference:'27-DDQ-PRODAT'})).toBe('electricity')
        expect(validateProdatSubtypePayload(wire).filter(isProductIssue)).toEqual([])
        for (const scope of ['all','dependent_only'] as const) {
          const onlyProduct = {...policy,fieldRules:canonicalProdat26AFieldRules('Z06').filter(rule => rule.fieldNumber === '242')}
          expect(validateCanonicalPolicyFields({policy:onlyProduct,rawSegments:wire.rawSegments,una:wire.una,scope}).filter(isProductIssue)).toEqual([])
        }
      })
    }
    it(`${alphabet.join('')}: both detached EL references work but full-message, gas and malformed evidence remain scoped`, () => {
      const wire = input(raw([line('1','A'),...characteristic('Z13','E64'),...characteristic('Z14','L639Q',3)],'Z06',alphabet),'Z06')
      const detached = {...wire,rawSegments:wire.rawSegments.filter(segment => ['LIN','CCI','CAV'].some(tag => segment.startsWith(tag)))}
      for (const reference of elReferences) {
        expect(prodatProductMarket({...detached,applicationReference:reference})).toBe('electricity')
        expect(validateProdatSubtypePayload({...detached,applicationReference:reference}).filter(isProductIssue)).toEqual([])
        expect(prodatProductMarket({...wire,applicationReference:reference,rawSegments:wire.rawSegments.slice(1)})).toBeNull()
        expect(prodatProductMarket({...wire,rawSegments:wire.rawSegments.map(segment => segment.replace('23-DDQ-PRODAT',reference+alphabet[0]+'EXTRA'))})).toBeNull()
      }
      for (const reference of ['27-DDQ-PRODAT','23-DDQ-UTILTS','23-DGI-PRODAT-EXTRA','']) {
        expect(prodatProductMarket({...detached,applicationReference:reference})).toBeNull()
        expect(prodatProductMarket({...wire,rawSegments:wire.rawSegments.map(segment => segment.replace('23-DDQ-PRODAT',reference))})).toBeNull()
      }
    })
    it(`${alphabet.join('')}: the unchanged canonical process validator still rejects DGI for Z06`, () => {
      const payload = raw([line('1','A'),...characteristic('Z13','E64'),...characteristic('Z14','L639Q',3)],'Z06',alphabet).replace('23-DDQ-PRODAT','23-DGI-PRODAT')
      const validation = validateRulebookMessage({family:'PRODAT',code:'Z06',direction:'outbound',rawPayload:payload,mode:'parse'})
      expect(validation.blocking).toBe(true)
      expect(validation.issues.some(issue => issue.code === 'CANONICAL_POLICY_VALIDATION_FAILED' && issue.description.includes('canonical_ediel_application_reference_not_allowed:Z06:23-DGI-PRODAT'))).toBe(true)
    })
  }
  for (const subtype of ['E','F','G']) it(`${subtype}: EL classification cannot widen canonical process permission`, () => {
    const args = {family:'PRODAT' as const,messageCode:'Z06',subtypeOrReasonCode:subtype,direction:'outbound' as const,referenceDate:'2026-09-18',mode:'catalog_evidence' as const,bilateralCapabilityVerified:true}
    expect(resolveCanonicalEdielPolicy({...args,applicationReference:'23-DDQ-PRODAT'}).applicationReference).toBe('23-DDQ-PRODAT')
    expect(() => resolveCanonicalEdielPolicy({...args,applicationReference:'23-DGI-PRODAT'})).toThrow(/canonical_ediel_application_reference_not_allowed:Z06:23-DGI-PRODAT/)
  })
})
