import {buildAperakDraft} from '@/lib/ediel/ack'
import {getEdielMessageById} from '@/lib/ediel/db'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {readReceivedProdatFinalResponsePlan,receivedProdatFinalResponseQualification} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {readExistingAckBeforeDraft} from '@/lib/ediel/core/ackDraftSource'
import {readSourceBoundOutboundAckRulePackEvidence} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import {createCanonicalAckMessage} from '@/lib/ediel/core/kernel'
import {createOutboxItem} from '@/lib/ediel/outbox/createOutboxItem'

/** Manual approval consumes actual native own effects. Each own response and
 * outbox identity is immutable; retries repair only an absent prepared outbox. */
export async function createReceivedProdatStructuralAcks(input:{actorUserId:string;companyId:string;sourceMessageId:string;objectLineIndices?:readonly number[]}):Promise<string[]>{
 await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permission:'communication.write'})
 const source=await getEdielMessageById(input.sourceMessageId)
 if(!source||source.company_id!==input.companyId||!source.raw_payload)throw new Error('prodat_structural_response_source_required')
 const final=await readReceivedProdatFinalResponsePlan({companyId:input.companyId,sourceMessageId:source.id,rawPayload:source.raw_payload,objectLineIndices:input.objectLineIndices})
 if(!final)throw new Error('prodat_structural_response_own_effect_unavailable')
 const ids:string[]=[]
 for(const plan of final.plans){
  const indices=receivedProdatFinalResponseQualification({plan,sourceMessage:final.sourceMessage})
  if(!indices)throw new Error('prodat_structural_response_own_effect_unavailable')
  let ack=await readExistingAckBeforeDraft({actorUserId:input.actorUserId,sourceMessage:final.sourceMessage,ackFamily:'APERAK',outcome:'positive',ackScope:'object',acknowledgedReferences:plan.acknowledgedReferences})
  const retained=ack!==null
  if(!ack){
   const qualification=await readSourceBoundOutboundAckRulePackEvidence({companyId:input.companyId,environment:source.environment,sourceMessageId:source.id})
   const draft=buildAperakDraft({actorUserId:input.actorUserId,sourceMessage:qualification.sourceMessage,outcome:'positive',ackScope:'object',
    ackSourceQualification:qualification,prodatAcknowledgementLineIndices:indices})
   ack=await createCanonicalAckMessage({actorUserId:input.actorUserId,sourceMessage:qualification.sourceMessage,ackFamily:'APERAK',outcome:'positive',draft})
  }
  await createOutboxItem({actorUserId:input.actorUserId,message:ack,sourceMessageId:source.id,status:retained?'prepared':'queued',queueOnlyIfInserted:true,
   lockKey:`ediel_structural_response:${ack.id}`,payload:{createdBy:'reviewed_structural_source_effect',sourceMessageId:source.id,objectLineIndices:indices,
    canonicalAssessmentId:plan.canonicalAssessmentId,objectAssessmentId:plan.objectAssessmentId,ackFamily:'APERAK',outcome:'positive'}})
  ids.push(ack.id)
 }
 return ids
}
