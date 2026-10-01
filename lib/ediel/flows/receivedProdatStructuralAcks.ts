import {buildAperakDraft} from '@/lib/ediel/ack'
import {getEdielMessageById} from '@/lib/ediel/db'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {readReceivedProdatFinalResponsePlan,receivedProdatFinalResponseQualification} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {readExistingAckBeforeDraft} from '@/lib/ediel/core/ackDraftSource'
import {readSourceBoundOutboundAckRulePackEvidence} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
import {createOutboxItem} from '@/lib/ediel/outbox/createOutboxItem'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'

/** Manual approval consumes actual native own effects. Each own response and
 * outbox identity is immutable; retries repair only an absent prepared outbox. */
export async function createReceivedProdatCommittedEffectAcks(input:{actorUserId:string;companyId:string;sourceMessageId:string;objectLineIndices?:readonly number[]}):Promise<string[]>{
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permission:'communication.write'})
 const source=await getEdielMessageById(input.sourceMessageId)
 if(!source||source.company_id!==input.companyId||!source.raw_payload||source.direction!=='inbound'||source.message_family!=='PRODAT'||!['Z04','Z05','Z06','Z10','Z14','Z15'].includes(source.message_code))throw new Error('prodat_structural_response_source_required')
 const wire=tokenizeEdifact(source.raw_payload),physical=prodatRegisterGroups(wire.segments,wire.una,source.message_code).groups.filter(group=>group.registerPosition===1)
 const selected=input.objectLineIndices===undefined?physical:physical.filter(group=>input.objectLineIndices!.includes(group.segments[0].index))
 if(input.objectLineIndices&&(!input.objectLineIndices.length||new Set(input.objectLineIndices).size!==input.objectLineIndices.length||selected.length!==input.objectLineIndices.length))throw new Error('prodat_structural_response_scope_required')
 const ids:string[]=[]
 const fixed=new Set<number>()
 // Read the actual fixed original before requiring any prospective primary
 // receipt/current owner. This is physical source membership, not acceptance.
 for(const group of selected){
  const lineIndex=group.segments[0].index,refs=group.segments.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]==='LI')
  if(refs.length!==1)continue
  const reference=segmentComposite(refs[0],1,wire.una)[1]
  if(!reference)continue
  const retained=await readExistingAckBeforeDraft({actorUserId:input.actorUserId,sourceMessage:source,ackFamily:'APERAK',ackScope:'object',acknowledgedReferences:[reference],
   acknowledgedProdatObjects:[{objectId:group.itemId,identityAgency:group.identityAgency,firstLineIndex:lineIndex,lineItemReference:reference}]})
  if(!retained)continue
  if(retained.ack_outcome!=='positive'){
   if(input.objectLineIndices)throw new Error('blocked_final_ack_exists: Originalets ACK-utfall är oföränderligt.')
   fixed.add(lineIndex);continue
  }
  await createOutboxItem({actorUserId:input.actorUserId,message:retained,sourceMessageId:source.id,status:'prepared',queueOnlyIfInserted:true,
   payload:{createdBy:'retained_source_response',sourceMessageId:source.id,objectLineIndices:[lineIndex],ackFamily:'APERAK',outcome:'positive'}})
  fixed.add(lineIndex);if(!ids.includes(retained.id))ids.push(retained.id)
 }
 const remaining=selected.filter(group=>!fixed.has(group.segments[0].index)).map(group=>group.segments[0].index)
 if(!remaining.length)return ids
 const final=await readReceivedProdatFinalResponsePlan({companyId:input.companyId,sourceMessageId:source.id,rawPayload:source.raw_payload,
  objectLineIndices:input.objectLineIndices?remaining:undefined})
 if(!final){if(ids.length&&input.objectLineIndices===undefined)return ids;throw new Error('prodat_structural_response_own_effect_unavailable')}
 for(const plan of final.plans){
  if(fixed.has(plan.objectLineIndices[0]))continue
  const indices=receivedProdatFinalResponseQualification({plan,sourceMessage:final.sourceMessage})
  if(!indices)throw new Error('prodat_structural_response_own_effect_unavailable')
  const own=physical.find(group=>group.segments[0].index===indices[0])
  if(!own||indices.length!==1)throw new Error('prodat_structural_response_scope_required')
  let ack=await readExistingAckBeforeDraft({actorUserId:input.actorUserId,sourceMessage:final.sourceMessage,ackFamily:'APERAK',outcome:'positive',ackScope:'object',acknowledgedReferences:plan.acknowledgedReferences,
   acknowledgedProdatObjects:[{objectId:own.itemId,identityAgency:own.identityAgency,firstLineIndex:indices[0],lineItemReference:plan.acknowledgedReferences[0]??null}]})
  const retained=ack!==null
  if(!ack){
   const qualification=await readSourceBoundOutboundAckRulePackEvidence({companyId:input.companyId,environment:source.environment,sourceMessageId:source.id})
   const draft=buildAperakDraft({actorUserId:input.actorUserId,sourceMessage:qualification.sourceMessage,outcome:'positive',ackScope:'object',
    ackSourceQualification:qualification,prodatAcknowledgementLineIndices:indices})
   ack=await createCanonicalAckMessage({actorUserId:input.actorUserId,sourceMessage:qualification.sourceMessage,ackFamily:'APERAK',outcome:'positive',draft})
  }
  await createOutboxItem({actorUserId:input.actorUserId,message:ack,sourceMessageId:source.id,status:retained?'prepared':'queued',queueOnlyIfInserted:true,
   payload:{createdBy:'reviewed_structural_source_effect',sourceMessageId:source.id,objectLineIndices:indices,
    canonicalAssessmentId:plan.canonicalAssessmentId,objectAssessmentId:plan.objectAssessmentId,effectReceiptId:plan.effectReceiptId,
    effectFactsHash:plan.effectFactsHash,effectKind:plan.effectKind,ackFamily:'APERAK',outcome:'positive'}})
  ids.push(ack.id)
 }
 return ids
}

/** Existing manual structural routes consume the same committed-effect port. */
export const createReceivedProdatStructuralAcks=createReceivedProdatCommittedEffectAcks
