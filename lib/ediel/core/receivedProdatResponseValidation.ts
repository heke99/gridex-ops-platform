import {hasReceivedZ04HStructuralFieldRejection} from '@/lib/ediel/prodat/receivedZ04HStructuralFieldRejection'
import {hasReceivedZ04HRequiredFieldRejection} from '@/lib/ediel/prodat/receivedZ04HRequiredFieldRejection'
import {hasReceivedZ04HRegisterRejection} from '@/lib/ediel/prodat/receivedZ04HRegisterRejection'
import {isDeepStrictEqual} from 'node:util'
import {hasReceivedZ05RejectedIdentityRejection} from '@/lib/ediel/prodat/receivedZ05RejectedIdentityRejection'
import {hasReceivedZ04RequiredStartRejection} from '@/lib/ediel/prodat/receivedZ04RequiredStartRejection'
import {segmentComposite,tokenizeEdifact} from './edifactTokenizer'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {bindReceivedRegisterValidation} from './receivedRegisterValidationBinding'
import {bindReceivedProdatApplicationObjects,qualifyReceivedProdatApplicationObject} from '@/lib/ediel/prodat/prodatApplicationObjectValidation'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {isQualifiedProdatApplicationError} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import type {CanonicalRuntimeDecision} from './runtimeDecision'
import type {EdielMessageRow} from '@/lib/ediel/types'

export type ReceivedProdatResponseValidation={version:1;sourcePayloadHash:string;objects:Array<{
 lineIndex:number;registerLineIndices:number[];id:string|null;li:string|null;outcome:'positive'|'negative'|'held'
}>;responses:Array<{scope:'message'|'object';lineIndex:number|null;ercCode:string;fieldCode:string|null;text:string;id:string|null;li:string|null}>}

/** Project the actual canonical plan through the actual ACK renderer. No
 * national rule is rerun, and an absent sibling response grants no acceptance.
 * This pure projection does not itself mint a same-invocation capability. */
export function buildReceivedProdatResponseValidation(message:EdielMessageRow,decision:CanonicalRuntimeDecision):ReceivedProdatResponseValidation|null {
 if(message.message_family!=='PRODAT'||message.direction!=='inbound'||!message.raw_payload||decision.syntaxDecision!=='accepted'
  ||decision.policy?.family!=='PRODAT'&&!hasReceivedZ04RequiredStartRejection(decision,message)&&!hasReceivedZ05RejectedIdentityRejection(decision,message)&&!hasReceivedZ04HRegisterRejection(decision,message)&&!hasReceivedZ04HRequiredFieldRejection(decision,message)&&!hasReceivedZ04HStructuralFieldRejection(decision,message)||!decision.validationReport.rulePackEvidence)return null
 try{
  const wire=tokenizeEdifact(message.raw_payload),groups=prodatRegisterGroups(wire.segments,wire.una).groups
  const registered=decision.prodatRegisterValidation
  if(!registered||registered.owner!=='validateProdatRegisterPolicy'||registered.coverage!=='canonical_register_only')return null
  const objects:ReceivedProdatResponseValidation['objects']=registered.objects.map(object=>{
   const registers=object.registers.map(register=>groups.find(group=>group.segments[0].index===register.segmentIndex))
   if(!registers.length||registers.some(group=>!group))throw Error('prodat_response_actual_register_owner_required')
   const first=registers[0]!

   const refs=first.segments.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]==='LI')
   if(refs.length>1)throw Error('prodat_response_own_reference_unavailable')
   return {lineIndex:first.segments[0].index,registerLineIndices:registers.map(group=>group!.segments[0].index),id:first.itemId,
    li:refs.length===1?segmentComposite(refs[0],1,wire.una)[1]||null:null,outcome:'held'}
  })
  const boundRegister=bindReceivedRegisterValidation(registered,message.raw_payload)
  const boundApplication=decision.prodatApplicationValidation
   ?bindReceivedProdatApplicationObjects({...decision.prodatApplicationValidation,sourcePayloadHash:evidenceHash(message.raw_payload)},message.raw_payload):null
  const responses:ReceivedProdatResponseValidation['responses']=[]
  for(const plan of decision.responsePlan.filter(response=>response.family==='APERAK')){
   if(plan.outcome!=='positive'&&plan.outcome!=='negative')return null
   if(plan.outcome==='negative'&&(!plan.applicationErrors?.length||!plan.applicationErrors.every(isQualifiedProdatApplicationError)))return null
   const rendered=renderAperakEdiel({source:{id:message.id,messageFamily:'PRODAT',messageCode:message.message_code,
    rawPayload:message.raw_payload,messageReceivedAt:message.message_received_at},refs:{},externalReference:'OWNER',transactionReference:'OWNER',
    outcome:plan.outcome,applicationErrors:plan.applicationErrors,
    // Projection of the prospective own outcome: unanswered siblings stay held.
    ...(plan.outcome==='negative'?{prodatProspectiveObjectProjection:true as const}:{})})
   const own=tokenizeEdifact(rendered.segments.map(segment=>segment+"'").join(''))
   const scope=segmentComposite(own.segments.find(segment=>segment.tag==='BGM'),3,own.una)[0]==='27'?'message':'object'
   for(const [index,segment]of own.segments.entries()){
    if(segment.tag!=='ERC')continue
    const next=own.segments.findIndex((part,position)=>position>index&&part.tag==='ERC'),end=next<0?own.segments.length:next
    const parts=own.segments.slice(index+1,end),ftx=parts.filter(part=>part.tag==='FTX')
    if(ftx.length!==1)return null
    const ref=(qualifier:string)=>{const refs=parts.filter(part=>part.tag==='RFF'&&segmentComposite(part,1,own.una)[0]===qualifier);if(refs.length>1)throw Error('prodat_response_duplicate_own_reference');return refs.length===1?segmentComposite(refs[0],1,own.una)[1]||null:null}
    const li=ref('LI'),id=ref('Z07'),ercCode=segmentComposite(segment,1,own.una)[0]
    const matches=objects.filter(object=>(li!==null?object.li===li:object.id===id)&&(id===null||object.id===id))
    if(scope==='object'&&matches.length!==1)return null
    const object=scope==='object'?matches[0]:null
    if(ercCode==='100'){
     // A protocol-positive plan is not an accepted own application. Preserve
     // held objects without inventing an ERC100 that the source SQL rejects.
     if(!object||decision.applicationDecision!=='accepted'||decision.functionalDecision!=='accepted')continue
     const candidates=boundRegister?.objects.filter(candidate=>candidate.objectId===object.id
      &&isDeepStrictEqual(candidate.registers.map(register=>register.segmentIndex),object.registerLineIndices))??[]
     if(candidates.length!==1||candidates[0].disposition!=='accepted'||!boundApplication)continue
     const candidate=candidates[0],ownScope={messageIndex:candidate.messageIndex,messageReference:candidate.messageReference,
      objectId:candidate.objectId,identityAgency:candidate.identityAgency,registers:candidate.registers}
     if(!qualifyReceivedProdatApplicationObject(boundApplication,ownScope))continue
     const ownApplications=boundApplication.objects.filter(application=>isDeepStrictEqual({messageIndex:application.messageIndex,
      messageReference:application.messageReference,objectId:application.objectId,identityAgency:application.identityAgency,registers:application.registers},ownScope))
     if(ownApplications.length!==1||ownApplications[0].reasonCodes.length)continue
    }
    if(object){const outcome=ercCode==='100'?'positive':'negative';if(object.outcome!=='held'&&object.outcome!==outcome)return null;object.outcome=outcome}
    responses.push({scope,lineIndex:object?.lineIndex??null,ercCode,fieldCode:segmentComposite(ftx[0],3,own.una)[0]||null,
     text:segmentComposite(ftx[0],4,own.una)[0],id,li})
   }
  }
  if(responses.some(response=>response.scope==='message')&&responses.some(response=>response.ercCode==='100'))return null
  return {version:1,sourcePayloadHash:evidenceHash(message.raw_payload),objects,responses}
 }catch{return null}
}

/** Serialization/source grouping parity only. A stored copy is not a fresh
 * runtime owner; the runtime WeakMap decides whether it may be recorded. */
export function bindReceivedProdatResponseValidation(value:unknown,raw:string):ReceivedProdatResponseValidation|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null
 const facet=value as ReceivedProdatResponseValidation
 if(Object.keys(facet).length!==4||facet.version!==1||facet.sourcePayloadHash!==evidenceHash(raw)||!Array.isArray(facet.objects)||!Array.isArray(facet.responses))return null
 try{
  const wire=tokenizeEdifact(raw),groups=prodatRegisterGroups(wire.segments,wire.una).groups
  const allIndices=groups.map(group=>group.segments[0].index),seen:number[]=[]
  for(const object of facet.objects){
   if(Object.keys(object).length!==5||!['positive','negative','held'].includes(object.outcome)||!Array.isArray(object.registerLineIndices)||!object.registerLineIndices.length
    ||object.lineIndex!==object.registerLineIndices[0]||object.registerLineIndices.some(index=>seen.includes(index)||!allIndices.includes(index)))return null
   const registers=object.registerLineIndices.map(index=>groups.find(group=>group.segments[0].index===index)!)
   const first=registers[0],refs=first.segments.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]==='LI')
   if(refs.length>1||registers.some(group=>group.itemId!==first.itemId||group.identityAgency!==first.identityAgency)||object.id!==first.itemId||object.li!==(refs.length===1?segmentComposite(refs[0],1,wire.una)[1]||null:null))return null
   seen.push(...object.registerLineIndices)
  }
  if(!isDeepStrictEqual([...seen].sort((a,b)=>a-b),allIndices))return null
  for(const response of facet.responses){
   if(Object.keys(response).length!==7||!['message','object'].includes(response.scope)||typeof response.ercCode!=='string'||typeof response.text!=='string'
    ||!response.text||response.text.length>512||/[\x00-\x1f\x7f]/.test(response.text)||!(response.fieldCode===null||typeof response.fieldCode==='string'))return null
   if(response.scope==='message'){if(response.lineIndex!==null||response.ercCode==='100')return null}
   else{const object=facet.objects.find(object=>object.lineIndex===response.lineIndex);if(!object||object.outcome===(response.ercCode==='100'?'negative':'positive')||object.outcome==='held'
    ||object.id!==response.id||object.li!==response.li)return null}
  }
  return structuredClone(facet)
 }catch{return null}
}
