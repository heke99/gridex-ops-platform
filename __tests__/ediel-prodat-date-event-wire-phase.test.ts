import {expect,it} from 'vitest'
import {resolveCanonicalEdielPolicy,isCanonicalProdatOwnWireDependentCondition} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {renderProdat} from '@/lib/ediel/prodat/engine'

const base={family:'PRODAT',messageCode:'Z09',direction:'outbound' as const,referenceDate:'2026-09-30',applicationReference:'23-DDQ-PRODAT',mode:'send' as const,prodatDependentFacts:{market:'electricity' as const}}
const segments=(reason:string,dates:string[]=[])=>['BGM+Z09+DOC+9','LIN+1++735123456789012345:MP::9','CCI++Z13',`CAV+${reason}`,...dates,'RFF+LI:OWN']

it.each(['F','G'])('resolves actual send candidate %s without fabricating date-event facts',subtype=>{
 const policy=resolveCanonicalEdielPolicy({...base,subtypeOrReasonCode:subtype})
 const dates=policy.prodatDependentConditions.filter(item=>['210','211'].includes(item.fieldNumber))
 expect(dates).toHaveLength(2)
 expect(dates.every(item=>item.status==='undetermined'&&isCanonicalProdatOwnWireDependentCondition(item))).toBe(true)
 const reason=subtype==='F'?'E64':'E32'
 const issues=validateCanonicalPolicyFields({policy,rawSegments:segments(reason,['DTM+92:202701010000:203']),scope:'dependent_only'})
 expect(issues).toContainEqual(expect.objectContaining({code:'PRODAT_DATE_EVENT_FORBIDDEN'}))
})

it('keeps own D date XOR and independently qualified event mandatory at rendered-wire phase',()=>{
 const policy=resolveCanonicalEdielPolicy({...base,subtypeOrReasonCode:'D'})
 const issues=validateCanonicalPolicyFields({policy,rawSegments:segments('Z70'),scope:'dependent_only'})
 expect(issues).toContainEqual(expect.objectContaining({code:'PRODAT_DATE_EVENT_XOR'}))
 expect(issues).toContainEqual(expect.objectContaining({code:'PRODAT_DATE_EVENT_UNDETERMINED'}))
})

it('blocks actual production renderer D without its own date event before any draft can persist',()=>{
 expect(()=>renderProdat({code:'Z09',variant:'D',mode:'production',generatedAt:new Date('2026-09-30T12:00:00Z'),
  actor:{senderEdielId:'12345',receiverEdielId:'54321'},route:{applicationReference:'23-DDQ-PRODAT'},version:{selectedVersion:'26.A',messageTypeToken:'PRODAT:D:97A:UN:26A'},
  context:{code:'Z09',customerName:'',bgmReference:'DOC',transactionReference:'OWN',senderEdielId:'12345',receiverEdielId:'54321',legalSenderId:'12345',legalReceiverId:'54321',meterPointId:'735123456789012345',meterPointIdAgency:'9',gridAreaId:'TES',reasonForTransaction:'Z70',dependentConditionFacts:{market:'electricity'}}})).toThrow(/PRODAT_DATE_EVENT_(XOR|UNDETERMINED)/)
})
