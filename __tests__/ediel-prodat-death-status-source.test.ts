import {it,expect} from 'vitest'
import {resolveProdatBusinessContext} from '@/lib/ediel/rulebook/prodatSubtypeRegistry'
import {resolveProdatDependentCondition} from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import {decideProdatAperak} from '@/lib/ediel/decisionEngine'
import {assertRulebookAllowsSend} from '@/lib/ediel/rulebook/sendGuards'
import {raw,line,characteristic,alphabets} from './fixtures/prodat-register'
import type {EdielMessageRow} from '@/lib/ediel/types'
// Original P26.A pp65,71,112,119,122; no expected result copied from an owner.
it('Z09E independently declares death; excluded Z05L cannot borrow root death',()=>{
 expect(resolveProdatDependentCondition({messageCode:'Z09',fieldNumber:'310',facts:{canonicalSubtype:'E'}})?.status).toBe('required')
 expect(resolveProdatDependentCondition({messageCode:'Z05',fieldNumber:'310',facts:{canonicalSubtype:'L',businessContext:'death'}})?.status).toBe('not_required')
})
it('nondeath bilateral exception is Z06E only; bankruptcy does not require status',()=>{
 expect(resolveProdatBusinessContext({messageCode:'Z09',subtypeOrReasonCode:'E',businessContext:'other_masterdata',bilateralCapabilityVerified:true}).ok).toBe(false)
 expect(resolveProdatBusinessContext({messageCode:'Z09',subtypeOrReasonCode:'E'})).toMatchObject({ok:true,customerStatusRequired:true})
 expect(resolveProdatBusinessContext({messageCode:'Z06',subtypeOrReasonCode:'E',businessContext:'bankruptcy',bilateralCapabilityVerified:true})).toMatchObject({ok:true,customerStatusRequired:false})
})
for(const alphabet of alphabets)it(`actual APERAK requires own Z09E310 ${alphabet.join('')}`,()=>{
 const payload=raw([line('1',"A'CCI++Z17"),...characteristic('Z13','E34'),...characteristic('Z17','Z41'),['RFF',['LI','LI-A']],line('2','B'),...characteristic('Z13','E34'),['RFF',['LI','LI-B']]],'Z09',alphabet)
 const r=decideProdatAperak({rawPayload:payload,testKind:'production'})
 expect(r.applicationErrors.filter(e=>e.fieldCode==='310')).toEqual([expect.objectContaining({ercCode:'41',referenceNumber:'B',lineItemReference:'LI-B'})])
})
it('persisted Z09E held separately from source-valid pure process even with allowInvalid',()=>{
 const message={direction:'outbound',environment:'test',message_family:'PRODAT',message_code:'Z09',raw_payload:raw([line('1','A'),...characteristic('Z13','E34'),...characteristic('Z17','Z41')],'Z09'),parsed_payload:{rulebookAllowInvalidSend:true}} as unknown as EdielMessageRow
 expect(()=>assertRulebookAllowsSend(message)).toThrow('PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED')
})
