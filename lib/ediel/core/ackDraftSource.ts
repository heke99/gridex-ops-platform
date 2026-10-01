import type {EdielMessageRow} from '@/lib/ediel/types'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {findExistingAckForSource,type AckFamily,type AckOutcome} from './ackPolicy'

/** Read an already fixed physical response before rendering a fresh draft. The
 * actual source hash and active tenant actor qualify this read; neither a
 * mutable outcome nor today's guide can reinterpret the retained original. */
export async function readExistingAckBeforeDraft(input:{
 actorUserId:string;sourceMessage:EdielMessageRow;ackFamily:AckFamily;outcome?:AckOutcome
 ackScope?:'interchange'|'message'|'transaction'|'object';acknowledgedReferences?:readonly string[]
}):Promise<EdielMessageRow|null>{
 const source=input.sourceMessage
 if(!source.company_id){
  // Unknown-recipient technical syntax responses resolve their endpoint inside
  // the existing technical gateway. This read does not guess that tenant.
  if(input.ackFamily==='CONTRL')return null
  throw new Error('canonical_ack_source_scope_mismatch')
 }
 if(source.direction!=='inbound'||source.message_standard!=='edifact'||!source.raw_payload)throw new Error('canonical_ack_source_scope_mismatch')
 await assertEdielTenantActor(source.environment==='test'&&input.ackFamily==='CONTRL'
  ?{companyId:source.company_id,actorUserId:input.actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']}
  :{companyId:source.company_id,actorUserId:input.actorUserId,permission:'communication.write'})
 const existing=await findExistingAckForSource({sourceMessageId:source.id,ackFamily:input.ackFamily,
  ackScope:input.ackScope,acknowledgedReferences:input.acknowledgedReferences,expectedSource:source})
 const requested=input.ackFamily==='UTILTS_ERR'?'negative':input.outcome
 if(existing&&requested&&existing.ack_outcome!==requested)throw new Error('blocked_final_ack_exists: Originalets ACK-utfall är oföränderligt.')
 return existing
}
