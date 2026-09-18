import { describe, expect, it } from 'vitest'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import { buildProdatMessage, type BuildProdatMessageInput } from '@/lib/ediel/prodat/buildProdat'
import { readProdatParty } from '@/lib/ediel/prodat/prodatPartyFields'
import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { isProdatFieldInInapplicableParent } from '@/lib/ediel/prodat/prodatParentApplicability'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'

const variants = [{subtype:'E',reason:'E34'},{subtype:'F',reason:'E64'},{subtype:'G',reason:'E32'}]
const context: ProdatEngineProductionContext = {code:'Z06',bgmReference:'D',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:'735999999999999999',customerId:'USR',customerName:'Synthetic',customerIdAgency:'89',customerCity:'Town',customerPostalCode:'00123',customerCountry:'SE',gridAreaId:'TES',startDate:'202610010000',reasonForTransaction:'E34',dependentConditionFacts:{market:'electricity',meterReadingsSentInUtilts:false}}
const request: BuildProdatMessageInput = {companyId:'tenant',role:'supplier',businessCode:'Z06',transactionSubtype:'E',sender:{edielId:'12345'},receiver:{edielId:'54321'},meteringPoint:{id:'735999999999999999',gridArea:'TES'},customer:{id:'USR',name:'Synthetic',idAgency:'89',country:'SE'},dates:{contractStartDate:'202610010000',validityStartDate:'202610010000'},references:{LI:'CASE'},codedAttributes:{Z13:'E34'},environment:'test',dependentConditionFacts:{market:'electricity',meterReadingsSentInUtilts:false}}
const target = (issue:{scope?:string;description:string}) => issue.scope==='prodat_dependent' && /Z0[69]:(?:END_USER_GROUP|227|228|231|232|316)/.test(issue.description)

for (const code of ['Z06','Z09'] as const) describe(`${code}: real builders retain source parent applicability`, () => {
  for (const {subtype,reason} of variants) it(`profile ${subtype}: optional root data cannot emit a forbidden parent`, () => {
    const result=buildProfiledProdatSegments({context:{...context,code,reasonForTransaction:reason},variant:subtype})
    expect(result.segments.filter(s=>s.startsWith('NAD+UD'))).toHaveLength(subtype==='E'?1:0)
    expect(validateProdatSubtypePayload({family:'PRODAT',code,rawSegments:result.segments}).filter(target)).toEqual([])
    if (subtype==='E') expect(readProdatParty('UD',result.segments)).toMatchObject({id:'USR',postalCode:'00123',city:'Town',country:'SE'})
  })
  it('profile reports a missing E postcode instead of declaring the UD builder valid', () => {
    const result=buildProfiledProdatSegments({context:{...context,code,customerPostalCode:null},variant:'E'})
    expect(result.issues.some(i=>i.severity==='error'&&i.description.includes(`${code}:231`)),JSON.stringify(result.issues)).toBe(true)
  })
  it('generic builder uses each object wire reason, not the root subtype', () => {
    // Typed structural extension permits current and newer builders to consume
    // the same fixture; missing output, not a TS cast, drives the red test.
    const customer={...request.customer,city:'Town',postalCode:'00123',name:'Synthetic',country:'SE'}
    const objects=variants.slice(0,2).map(({reason},i)=>({meteringPoint:{id:`OBJECT-${i}`,gridArea:'TES'},customer,codedAttributes:{Z13:reason},dates:request.dates,references:{LI:`CASE-${i}`}}))
    const result=buildProdatMessage({...request,businessCode:code,transactionSubtype:'F',objects})
    const wire=tokenizeEdifact(result.rawEdifact)
    expect(wire.segments.filter(s=>s.tag==='NAD'&&s.raw.startsWith('NAD+UD'))).toHaveLength(1)
    expect(validateProdatSubtypePayload({family:'PRODAT',code,rawSegments:wire.segments.map(s=>s.raw),una:wire.una}).filter(target)).toEqual([])
    expect(readProdatParty('UD',wire.segments,wire.una)).toMatchObject({postalCode:'00123',city:'Town'})
  })
  it('generic E builder rejects absent required customer data rather than returning a sendable candidate', () => {
    expect(()=>buildProdatMessage({...request,businessCode:code,customer:null})).toThrow(/END_USER_GROUP|elanvändargrupp/)
  })
})

it('keeps unrelated Z14N exclusions and does not globally suppress other parents', () => {
  for (const field of ['END_USER_GROUP','227','228','229','231','232','316','INSTALLATION_GROUP','233','234','235','236','237']) {
    expect(isProdatFieldInInapplicableParent({messageCode:'Z14',subtype:'N',fieldNumber:field})).toBe(true)
  }
  for (const code of ['Z04','Z06','Z09']) expect(isProdatFieldInInapplicableParent({messageCode:code,subtype:'F',fieldNumber:'INVOICEE_GROUP'})).toBe(false)
})
