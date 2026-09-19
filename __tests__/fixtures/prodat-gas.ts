import {raw,line,characteristic,input,alphabets,type Parts} from '@/__tests__/fixtures/prodat-register'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
export {input,alphabets,line,characteristic}
export function payload(code='Z04',reason='Z22',extra:Parts[]=[],market='electricity',alphabet:readonly string[]=alphabets[0]){
 const wire=raw([line('1','A'),...characteristic('Z13',reason),['RFF',['LI','EVENT-A']],...extra],code,alphabet)
 return market==='gas'?wire.replace('23-DDQ-PRODAT','27-DDQ-PRODAT').replace('E2SE6A','E2SE6B'):wire
}
export function fields(wire:string,code='Z04',subtype='L',market:unknown='electricity',direction:'inbound'|'outbound'='outbound'){
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:subtype,direction,referenceDate:'2026-09-19',applicationReference:'23-DDQ-PRODAT',mode:'catalog_evidence',prodatDependentFacts:{market:market as never}})
 return validateCanonicalPolicyFields({policy:{...policy,fieldRules:policy.fieldRules.filter(r=>'fieldNumber' in r && ['320','240'].includes(r.fieldNumber??''))},...input(wire,code)})
}
// Independent synthetic causal source. No persisted producer or TIM/SCH value qualification.
export function selection(changed?:boolean,code:'Z06'|'Z10'='Z06'){
 return {source:{kind:'caller_selection' as const,reference:'local-event-selection'},objects:[{
  objectKey:'OBJECT-A',installation:{id:'A',agency:'89' as '89'|'9'},lineItemReference:'EVENT-A',
  process:code==='Z06'?{code,reason:'E64' as 'E64'|'E32'}:{code,reason:'E58' as const},
  event:{key:'EVENT-A',revision:'r1',reference:'event-source'},
  assessment:changed===undefined?{kind:'unknown' as const}:{kind:'known' as const,dimension:'serial_id_changed_due_to_this_event' as const,changed,evidence:{key:'ASSESS-A',revision:'v1',reference:'assessment-source',eventKey:'EVENT-A',eventRevision:'r1'}}
 }]}
}
