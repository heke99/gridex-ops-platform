import {readProdatCommonHeaderRejectionEvidence,type ProdatCommonHeaderRejectionEvidence} from './prodatCommonHeaderRejectionAuthority'
import {observeAssignedProdatHeaderNegativeField} from '@/lib/inbound-mail/prodatAssignedHeaderRejectionIntake'
import {buildAckDraftForSource,getUtiltsAckTransactionTargets} from '@/lib/ediel/ack'
import {readExistingAckBeforeDraft} from '@/lib/ediel/core/ackDraftSource'
import {readSourceBoundOutboundAckRulePackEvidence} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatDocumentState} from '@/lib/ediel/prodat/prodatDocumentFields'
import {prodatAckObjectScopes,resolveProdatAckMessageFunction} from '@/lib/ediel/prodat/prodatAckMessageFunction'

const protectedDocumentReferenceHolds=new WeakSet<Error>()
/** Only this exact post-replay guard error qualifies the retained hold. A copied
 * message, RPC refusal or caller-created Error cannot provide that provenance. */
export function isProtectedProdatDocumentReferenceHold(error:unknown):boolean{
 return error instanceof Error&&protectedDocumentReferenceHolds.has(error)
}

/** Operational construction follows protected replay first, then the actual
 * immutable source capability. The public synchronous builder remains a pure
 * observational renderer and cannot provide this original authority itself. */
export async function prepareSourceAckDraft(input:Parameters<typeof buildAckDraftForSource>[0]&{actorUserId:string;onDocumentReferenceHold?:(hold:Error)=>void}):Promise<
 {kind:'existing';message:EdielMessageRow}|{kind:'draft';draft:CreateEdielMessageInput}
>{
 let references:string[],scope:'interchange'|'message'|'transaction'|'object'
 const sourceWire=input.ackFamily==='APERAK'&&input.sourceMessage.raw_payload?tokenizeEdifact(input.sourceMessage.raw_payload):null
 const sourceUnh=sourceWire?.segments.find(token=>token.tag==='UNH')
 const isProdat=input.ackFamily==='APERAK'&&sourceWire&&sourceUnh&&segmentComposite(sourceUnh,2,sourceWire.una)[0]==='PRODAT'
 if(isProdat){
  // True P27/header originals cover the whole source and are read before any
  // fresh error qualification. A P34 original never satisfies this read.
  const whole=await readExistingAckBeforeDraft({actorUserId:input.actorUserId,sourceMessage:input.sourceMessage,ackFamily:'APERAK',outcome:input.outcome,ackScope:'message'})
  if(whole)return {kind:'existing',message:whole}
  let referenceError:unknown,objects:ReturnType<typeof prodatAckObjectScopes>=[]
  try{objects=prodatAckObjectScopes({sourceWire,messageCode:input.sourceMessage.message_code,outcome:input.outcome??'positive',applicationErrors:input.applicationErrors,relatedTransactionReference:input.relatedTransactionReference,prodatAcknowledgementLineIndices:input.prodatAcknowledgementLineIndices});references=objects.flatMap(own=>own.lineItemReference?[own.lineItemReference]:[])}
  catch(error){referenceError=error;references=[]}
  if(objects.length){
   const original=await readExistingAckBeforeDraft({actorUserId:input.actorUserId,sourceMessage:input.sourceMessage,ackFamily:'APERAK',outcome:input.outcome,ackScope:'object',acknowledgedReferences:references,acknowledgedProdatObjects:objects})
   if(original)return {kind:'existing',message:original}
  }
  // A255 cannot copy an absent physical header BGM/1004. Preserve both
  // protected replay reads and their actor/source refusals before this fresh
  // correlation hold; present invalid IDs retain their existing path.
  const document=prodatDocumentState('203',sourceWire.segments,sourceWire.una)
  if(!document.present){
   const hold=new Error('aperak_prodat_document_reference_required')
   protectedDocumentReferenceHolds.add(hold)
   input.onDocumentReferenceHold?.(hold)
   throw hold
  }
  const fn=resolveProdatAckMessageFunction({sourceWire,hasProdatWire:true,messageCode:input.sourceMessage.message_code,outcome:input.outcome??'positive',applicationErrors:input.applicationErrors})
  if(fn==='34'&&referenceError)throw referenceError
  if(fn==='34'&&!objects.length)throw new Error('aperak_prodat_requested_scope_unqualified')
  scope=fn==='27'?'message':'object'
 }else{
  references=input.ackFamily==='CONTRL'||input.utiltsHeaderRejected?[]:input.relatedTransactionReference?[input.relatedTransactionReference]
   :getUtiltsAckTransactionTargets(input.sourceMessage).map(target=>target.reference)
  scope=input.ackFamily==='CONTRL'?'interchange':references.length?'transaction':input.ackScope??'message'
  const existing=await readExistingAckBeforeDraft({actorUserId:input.actorUserId,sourceMessage:input.sourceMessage,ackFamily:input.ackFamily,outcome:input.outcome,ackScope:scope,acknowledgedReferences:references})
  if(existing)return {kind:'existing',message:existing}
 }
 const needsOriginal=input.ackFamily==='UTILTS_ERR'||input.ackFamily==='APERAK'&&input.sourceMessage.message_family==='UTILTS_ERR'
 const companyId=input.sourceMessage.company_id
 if(needsOriginal&&!companyId)throw new Error('canonical_ack_source_scope_mismatch')
 const ackSourceQualification=needsOriginal?await readSourceBoundOutboundAckRulePackEvidence({companyId:companyId!,environment:input.sourceMessage.environment,sourceMessageId:input.sourceMessage.id}):input.ackSourceQualification
 let commonEvidence:ProdatCommonHeaderRejectionEvidence|undefined
 if(input.ackFamily==='APERAK'&&input.outcome==='negative'&&input.sourceMessage.raw_payload
   &&observeAssignedProdatHeaderNegativeField(input.sourceMessage.raw_payload)==='311'){
   if(!companyId)throw new Error('canonical_ack_source_scope_mismatch')
   commonEvidence=(await readProdatCommonHeaderRejectionEvidence({companyId,environment:input.sourceMessage.environment,
     sourceMessageId:input.sourceMessage.id,expectedRawPayload:input.sourceMessage.raw_payload,actorUserId:input.actorUserId})).evidence
 }
 return {kind:'draft',draft:buildAckDraftForSource({...input,ackScope:scope,ackSourceQualification,prodatCommonHeaderRejectionEvidence:commonEvidence})}
}
