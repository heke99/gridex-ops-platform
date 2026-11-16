import {needsPeriodicDgiReason,periodicReasonFacts,type PeriodicReasonAuthority} from './periodicReasonAuthority'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {UtiltsRuntimeResult,UtiltsValidationIssue} from '@/lib/ediel/utiltsEngine.part-1'
/** Source U §3.6.11 / OE2g: current ESCO periodic DGI defaults to E23.
 * A signed and separately reviewed bilateral exception can qualify E88.
 * Unavailable scope gives a local hold, never an invented national rejection. */
export function applyPeriodicReasonGuide(input:{message:EdielMessageRow;policy:CanonicalEdielPolicy;result:UtiltsRuntimeResult;authority?:PeriodicReasonAuthority;
 rebuild:(input:{message:EdielMessageRow;result:UtiltsRuntimeResult;issues:UtiltsValidationIssue[]})=>UtiltsRuntimeResult}):UtiltsRuntimeResult{
 if(!needsPeriodicDgiReason(input.message,input.policy))return input.result
 const facts=input.authority?periodicReasonFacts({authority:input.authority,message:input.message,policy:input.policy}):{status:'held' as const,holdReason:'ediel_periodic_reason_authority_required',expectedReasons:[]}
 if(facts.status==='not_applicable')return input.result
 if(facts.status==='qualified'){
  const wire=tokenizeEdifact(input.message.raw_payload!),issues:UtiltsValidationIssue[]=[]
  for(const own of facts.expectedReasons){
   if(own.receivedReasonCode===own.reasonCode)continue
   const ide=wire.segments.filter(x=>x.tag==='IDE')[own.transactionIndex],end=wire.segments.find(x=>x.index>ide.index&&['IDE','UNT'].includes(x.tag))?.index??Infinity
   const received=wire.segments.find(x=>x.tag==='STS'&&x.index>ide.index&&x.index<end&&segmentComposite(x,1,wire.una)[0]==='7')
   if(!received||segmentComposite(received,3,wire.una)[0]!==own.receivedReasonCode)throw Error('ediel_periodic_reason_physical_occurrence_mismatch')
   issues.push({severity:'error',kind:'application',code:'UTILTS_PERIODIC_DGI_REASON_INVALID',title:'Felaktig periodisk transaktionsorsak',description:`Autentiserad periodisk E66 till energitjänsteföretag kräver ${own.reasonCode} enligt U §3.6.11/OE2g och aktuellt separat avtalsunderlag.`,
    aperakErcCode:'42',aperakFieldCode:'223',aperakText:'INCORRECT DATA',aperakInvalidOccurrence:{segmentIndex:received.index,elementIndex:3,componentIndex:0},referenceQualifier:'ACW',referenceNumber:own.transactionId,lineItemReference:own.transactionId})
  }
  return issues.length?input.rebuild({message:input.message,result:input.result,issues:[...input.result.validation.issues,...issues]}):input.result
 }
 const held=new Set(input.result.transactionDispositions.filter(x=>x.disposition==='accepted'||x.disposition==='processability_rejected').map(x=>x.transactionId))
 if(!held.size)return input.result
 const result=input.result,dispositions=result.transactionDispositions.map(x=>held.has(x.transactionId)?{...x,disposition:'internal_review' as const,responseType:'none' as const,issueCodes:[...x.issueCodes,'UTILTS_PERIODIC_REASON_SOURCE_UNAVAILABLE']}:x)
 return {...result,transactionDispositions:dispositions,validation:{...result.validation,ok:false,classification:result.validation.classification==='application_rejected'?result.validation.classification:'internal_review',
  issues:[...result.validation.issues,{severity:'warning',kind:'application',code:'UTILTS_PERIODIC_REASON_SOURCE_UNAVAILABLE',title:'Periodiskt avtalsunderlag saknas',description:facts.holdReason??'Current native bilateral reason qualification unavailable.'}]},
  ackPlan:{...result.ackPlan,shouldSendUtiltsErr:false,...(result.ackPlan.aperakOutcome==='positive'?{shouldSendAperak:false,aperakOutcome:null}:{}),reason:'Periodisk avtalsscope är inte kvalificerad; inga positiva affärseffekter eller nationella felkoder skapas.'}}
}
