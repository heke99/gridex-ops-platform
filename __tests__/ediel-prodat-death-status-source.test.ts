import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {resolveProdatBusinessContext} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import {resolveProdatDependentCondition} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {assertRulebookAllowsSend} from '@/lib/ediel/rulebook/sendGuards'
import {line,characteristic,alphabets} from './fixtures/prodat-register'
import {deathRaw,deathSelection} from './fixtures/prodat-death-status'
import {bindDeathStatusSourceContext,assertDeathStatusSendBoundary} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import type {EdielMessageRow} from '@/lib/ediel/types'
// Original P26.A pp65,71,112,119,122; no expected result copied from an owner.
it('Z09E selects the process but only its separate death assessment requires310; excluded Z05L cannot borrow root death',()=>{
 expect(resolveProdatDependentCondition({messageCode:'Z09',fieldNumber:'310',facts:{canonicalSubtype:'E'}})?.status).toBe('undetermined')
 expect(resolveProdatDependentCondition({messageCode:'Z09',fieldNumber:'310',facts:{canonicalSubtype:'E',deathStatus:deathSelection('death','Z09')}})?.status).toBe('required')
 expect(resolveProdatDependentCondition({messageCode:'Z09',fieldNumber:'310',facts:{canonicalSubtype:'E',deathStatus:deathSelection('not_death','Z09')}})?.status).toBe('not_required')
 expect(resolveProdatDependentCondition({messageCode:'Z05',fieldNumber:'310',facts:{canonicalSubtype:'L',businessContext:'death'}})?.status).toBe('not_required')
})
it('source-specific nondeath bilateral process supports Z06E/Z09E but literal E34 and bankruptcy do not prove death',()=>{
 expect(resolveProdatBusinessContext({messageCode:'Z09',subtypeOrReasonCode:'E',businessContext:'other_masterdata',bilateralCapabilityVerified:true})).toMatchObject({ok:true,customerStatusRequired:false,bilateralRequired:true})
 expect(resolveProdatBusinessContext({messageCode:'Z09',subtypeOrReasonCode:'E'})).toMatchObject({ok:false,customerStatusRequired:false,bilateralRequired:true})
 expect(resolveProdatBusinessContext({messageCode:'Z06',subtypeOrReasonCode:'E',businessContext:'bankruptcy',bilateralCapabilityVerified:true})).toMatchObject({ok:true,customerStatusRequired:false})
})
for(const alphabet of alphabets)it(`actual APERAK requires own Z09E310 ${alphabet.join('')}`,()=>{
 const selected=deathSelection('death','Z09'),second=structuredClone(selected.objects[0]),firstId="A'CCI++Z17"
 Object.assign(selected.objects[0],{objectKey:'object-A',installation:{id:firstId,agency:'89'},customer:{...selected.objects[0].customer,id:'CUSTOMER-A'},lineItemReference:'LI-A'})
 Object.assign(second,{objectKey:'object-B',installation:{id:'B',agency:'89'},customer:{...second.customer,id:'CUSTOMER-B'},lineItemReference:'LI-B'});selected.objects.push(second)
 const payload=deathRaw('Z09',[line('1',firstId),...characteristic('Z13','E34'),...characteristic('Z17','Z41'),['RFF',['LI','LI-A']],['NAD','UD',['CUSTOMER-A','','89']],line('2','B'),...characteristic('Z13','E34'),['RFF',['LI','LI-B']],['NAD','UD',['CUSTOMER-B','','89']]],alphabet)
 expect(decideProdatAperak({rawPayload:payload,testKind:'production'}).applicationErrors.filter(e=>e.fieldCode==='310')).toEqual([])
 const r=decideProdatAperak({rawPayload:payload,testKind:'production',deathStatus:selected})
 expect(r.applicationErrors.filter(e=>e.fieldCode==='310')).toEqual([expect.objectContaining({ercCode:'41',referenceNumber:'B',lineItemReference:'LI-B'})])
})
it('persisted Z09E held separately from source-valid pure process even with allowInvalid',()=>{
 const message={direction:'outbound',environment:'test',message_family:'PRODAT',message_code:'Z09',raw_payload:deathRaw('Z09',[line('1','A'),...characteristic('Z13','E34'),...characteristic('Z17','Z41')]),parsed_payload:{rulebookAllowInvalidSend:true}} as unknown as EdielMessageRow
 expect(()=>assertRulebookAllowsSend(message)).toThrow('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
})
it('the actual opaque source-only context admits only exact own raw/scope; copies and changed company stay held',()=>{
 const payload=deathRaw('Z09',[line('1','A'),...characteristic('Z13','E34'),...characteristic('Z17','Z41'),['RFF',['LI','LI-A']],['NAD','UD',['CUSTOMER-A','','89']]])
 const row={direction:'outbound' as const,environment:'test' as const,company_id:'11111111-1111-4111-8111-111111111111',message_family:'PRODAT',message_code:'Z09',raw_payload:payload,intent_id:'22222222-2222-4222-8222-222222222222',communication_route_id:'33333333-3333-4333-8333-333333333333'}
 // Explicit unit resolver boundary only; not native persisted legal approval.
 const context=bindDeathStatusSourceContext({kind:'customer_life_event',direction:'outbound',code:'Z09',companyId:row.company_id,environment:'test',rawPayload:payload,sourceEventId:'44444444-4444-4444-8444-444444444444',sourceRevision:'2',sourceDigest:createHash('sha256').update('SYNTHETIC independently classified death source v2').digest('hex'),businessContext:'death',bilateralCapabilityVerified:false,selection:deathSelection('death','Z09'),intentId:row.intent_id,routeId:row.communication_route_id})
 expect(()=>assertDeathStatusSendBoundary(row,context)).not.toThrow()
 expect(()=>assertDeathStatusSendBoundary(row,structuredClone(context))).toThrow('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
 expect(()=>assertDeathStatusSendBoundary({...row,company_id:'foreign'},context)).toThrow('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
 expect(()=>assertDeathStatusSendBoundary({...row,raw_payload:payload+'FTX+CHANGED\''},context)).toThrow('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
})
