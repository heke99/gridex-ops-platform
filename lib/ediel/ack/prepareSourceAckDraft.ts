import {buildAckDraftForSource,getUtiltsAckTransactionTargets} from '@/lib/ediel/ack'
import {readExistingAckBeforeDraft} from '@/lib/ediel/core/ackDraftSource'
import {readSourceBoundOutboundAckRulePackEvidence} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import type {CreateEdielMessageInput,EdielMessageRow} from '@/lib/ediel/types'

/** Operational construction follows protected replay first, then the actual
 * immutable source capability. The public synchronous builder remains a pure
 * observational renderer and cannot provide this original authority itself. */
export async function prepareSourceAckDraft(input:Parameters<typeof buildAckDraftForSource>[0]&{actorUserId:string}):Promise<
 {kind:'existing';message:EdielMessageRow}|{kind:'draft';draft:CreateEdielMessageInput}
>{
 const references=input.ackFamily==='CONTRL'||input.utiltsHeaderRejected?[]:input.relatedTransactionReference?[input.relatedTransactionReference]
  :getUtiltsAckTransactionTargets(input.sourceMessage).map(target=>target.reference)
 const existing=await readExistingAckBeforeDraft({actorUserId:input.actorUserId,sourceMessage:input.sourceMessage,ackFamily:input.ackFamily,outcome:input.outcome,
  ackScope:input.ackFamily==='CONTRL'?'interchange':references.length?'transaction':input.ackScope??'message',acknowledgedReferences:references})
 if(existing)return {kind:'existing',message:existing}
 const needsOriginal=input.ackFamily==='UTILTS_ERR'||input.ackFamily==='APERAK'&&input.sourceMessage.message_family==='UTILTS_ERR'
 const companyId=input.sourceMessage.company_id
 if(needsOriginal&&!companyId)throw new Error('canonical_ack_source_scope_mismatch')
 const ackSourceQualification=needsOriginal?await readSourceBoundOutboundAckRulePackEvidence({companyId:companyId!,environment:input.sourceMessage.environment,sourceMessageId:input.sourceMessage.id}):input.ackSourceQualification
 return {kind:'draft',draft:buildAckDraftForSource({...input,ackSourceQualification})}
}
