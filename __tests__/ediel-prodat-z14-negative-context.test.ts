import { expect, it } from 'vitest'
import { buildProdatMessage } from '@/lib/ediel/prodat/buildProdat'
import { buildZ14Segments } from '@/lib/ediel/prodat/builders/z14'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { assertRulebookAllowsSend } from '@/lib/ediel/rulebook/sendGuards'
import { assertEdielSendLock } from '@/lib/ediel/transport/sendLock'
import { preflightEdielMessageRow } from '@/lib/ediel/core/messageBuilder/payloadPreflight'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { alphabets, characteristic, input, line, raw, type Parts } from './fixtures/prodat-register'
import type { EdielMessageRow } from '@/lib/ediel/types'
const reason=(value:string)=>characteristic('Z13',value)
const target=(i:{code:string;description:string})=>i.description.includes('Z14:321')||i.description.includes('Z14:323')
function row(body:Parts[],alphabet:readonly string[]):EdielMessageRow {
 return {message_family:'PRODAT',message_code:'Z14',direction:'outbound',environment:'test',message_standard:'edifact',company_id:'synthetic',
 raw_payload:raw(body,'Z14',alphabet),application_reference:'23-DDQ-PRODAT',mime_type:'application/EDIFACT',
 validation_report:{systemTestAckSend:{enabled:true,source:'system_test_ack_action'}},parsed_payload:{rulebookAllowInvalidSend:true,prodatEngine:{dependentConditionStatuses:[]}}} as unknown as EdielMessageRow
}
const positive=(id='A',seq='1'):Parts[]=>[line(seq,id),['DTM',['90','202610010000','203']],['DTM',['354','15','806']],['DTM',['693','202609191200','203']],
...reason('S17'),...characteristic('Z04','Z04'),...characteristic('Z12','D',3),...characteristic('Z14','8716867000030',4),...characteristic('Z22','E17'),
['RFF',['Z05','ABC']],['RFF',['Z09','P']],['NAD','UD',['ID','','89'],'','User','','','','','SE'],['NAD','IT',[id,'','89'],'','','Site']]
for(const alphabet of alphabets){
 const label=alphabet.join('')
 for(const [name,extra] of [
 ['date',[['DTM',['91','202610010000','203']]]],['empty-date',[['DTM',['91','','203']]]],['padded-date',[['DTM',[' 91','202610010000','203']]]],
 ['purpose',characteristic('Z24','B71')],['empty-purpose',characteristic('Z24','')],['padded-purpose',characteristic(' Z24','B71')],
 ['malformed-sibling',[...characteristic('Z24','B71'),...characteristic('Z24','A02')]],
 ] as [string,Parts[]][]){
  it(`${label} rejects N ${name} at every protected boundary`,()=>{
   const message=row([['LIN','1'],...extra,...reason('Z96')],alphabet)
   expect(()=>assertEdielSendLock(message)).toThrow(/Z14:(321|323)/)
   expect(()=>assertRulebookAllowsSend(message)).toThrow(/Z14:(321|323)/)
   const production={...message,environment:'production' as const}
   expect(()=>assertEdielSendLock(production)).toThrow(/Z14:(321|323)/)
   expect(()=>assertRulebookAllowsSend(production)).toThrow(/Z14:(321|323)/)
   expect(preflightEdielMessageRow(message,'send').issues.some(target)).toBe(true)
   const wire=input(message.raw_payload!,'Z14')
   expect(validateProdatSubtypePayload(wire).some(target)).toBe(true)
   const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z14',subtypeOrReasonCode:'V',direction:'outbound',referenceDate:'2026-09-19',mode:'catalog_evidence',prodatDependentFacts:{customerKind:'private',byCell:{'Z14:321':true}}})
   for(const scope of ['all','dependent_only'] as const)expect(validateCanonicalPolicyFields({policy,...wire,scope}).some(i=>target(i)&&i.scope==='prodat_dependent')).toBe(true)
   expect(validateRulebookMessage({rawPayload:message.raw_payload!,direction:'inbound',mode:'parse',environment:'test'}).issues.filter(i=>target(i)&&i.scope==='prodat_dependent')).toEqual([])
  })
 }
 for(const extra of [[['DTM',['91','202610010000','203']]],characteristic('Z24','B71'),characteristic(' Z24','A02')] as Parts[][])it(`${label} supplied context in header cannot disappear`,()=>{
  expect(()=>assertEdielSendLock(row([...extra,['LIN','1'],...reason('Z96')],alphabet))).toThrow(/Z14:(321|323)/)
 })
 it(`${label} minimal N and valid positive supplied context remain unchanged`,()=>{
  expect(()=>assertEdielSendLock(row([['LIN','1'],...reason('Z96')],alphabet))).not.toThrow()
  const body=positive();body.splice(1,0,['DTM',['91','202611010000','203']]);body.splice(6,0,...characteristic('Z24','B71'))
  expect(validateProdatSubtypePayload(input(raw(body,'Z14',alphabet),'Z14')).filter(target)).toEqual([])
 })
 it(`${label} mixed objects use their own reason and cannot lend an exclusion`,()=>{
  const body=positive();body.splice(1,0,['DTM',['91','202611010000','203']]);body.splice(6,0,...characteristic('Z24','B71'))
  expect(validateProdatSubtypePayload(input(raw([...body,['LIN','2'],...reason('Z96')],'Z14',alphabet),'Z14')).filter(target)).toEqual([])
  expect(()=>assertEdielSendLock(row([...positive(),['LIN','2'],...reason('Z96'),...characteristic('Z24','B71')],alphabet))).toThrow(/Z14:323/)
 })
 it(`${label} malformed and alias reasons remain protected unknown`,()=>{
  for(const value of ['N',' Z96','E34']) expect(()=>assertEdielSendLock(row([['LIN','1'],...reason(value)],alphabet))).toThrow(/Z14:/)
 })
}

it('generic and profiled builders reject emitted purpose on N',()=>{
 expect(()=>buildProdatMessage({companyId:'synthetic',role:'energy_service_company',businessCode:'Z14',transactionSubtype:'N',sender:{edielId:'12345'},receiver:{edielId:'54321'},environment:'test',codedAttributes:{Z13:'Z96',Z24:'B71'}})).toThrow(/Z14:323/)
 const result=buildZ14Segments({context:{code:'Z14',bgmReference:'DOC',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:'',customerName:'',reasonForTransaction:'Z96',permissionPurpose:'B71'}})
 expect(result.issues.some(i=>i.description.includes('Z14:323'))).toBe(true)
})
it('direct inbound canonical validation preserves its existing parse-only contract',()=>{
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z14',subtypeOrReasonCode:'N',direction:'inbound',applicationReference:'23-DGI-PRODAT',referenceDate:'2026-09-19',mode:'parse'})
 const wire=input(raw([['LIN','1'],...reason('Z96'),...characteristic('Z24','B71')],'Z14'),'Z14')
 expect(validateCanonicalPolicyFields({policy,...wire}).filter(i=>target(i)&&i.scope==='prodat_dependent')).toEqual([])
})
