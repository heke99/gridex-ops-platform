import {createHash} from 'node:crypto'
import {segmentComposite,observeCompletedEdifactSegments} from '@/lib/ediel/core/edifactTokenizer'
import {readEdielTechnicalSourceEndpoint} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {findExistingAckForSource,type AckFamily,type AckOutcome} from './ackPolicy'
import type {ProdatAckObjectScope} from '@/lib/ediel/ack/sourceCorrelation'

/** Read an already fixed physical response before rendering a fresh draft. The
 * actual source hash and active tenant actor qualify this read; neither a
 * mutable outcome nor today's guide can reinterpret the retained original. */
export async function readExistingAckBeforeDraft(input:{
 actorUserId:string;sourceMessage:EdielMessageRow;ackFamily:AckFamily;outcome?:AckOutcome
 ackScope?:'interchange'|'message'|'transaction'|'object';acknowledgedReferences?:readonly string[]
 acknowledgedProdatObjects?:readonly ProdatAckObjectScope[]
}):Promise<EdielMessageRow|null>{
 const source=input.sourceMessage
 if(source.direction!=='inbound'||source.message_standard!=='edifact'||!source.raw_payload)throw new Error('canonical_ack_source_scope_mismatch')
 let companyId=source.company_id,expectedTechnicalCompanyId:string|undefined
 if(!companyId){
  if(input.ackFamily==='UTILTS_ERR')throw new Error('canonical_ack_source_scope_mismatch')
  const endpoint=await readEdielTechnicalSourceEndpoint(source.id)
  if(!endpoint){if(input.ackFamily==='CONTRL')return null;throw new Error('canonical_ack_technical_source_basis_unavailable')}
  if(endpoint.sourceMessageId!==source.id||endpoint.environment!==source.environment||endpoint.sourceHash!==createHash('sha256').update(source.raw_payload,'utf8').digest('hex'))throw new Error('canonical_ack_source_scope_mismatch')
  companyId=endpoint.companyId;expectedTechnicalCompanyId=companyId
 }
 const observed=expectedTechnicalCompanyId&&input.ackFamily==='APERAK'?observeCompletedEdifactSegments(source.raw_payload):null
 const unh=observed?.segments.find(segment=>segment.tag==='UNH')
 const commonTechnicalRead=Boolean(observed&&unh&&segmentComposite(unh,2,observed.una)[0]==='PRODAT')
 await assertEdielTenantActor(source.environment==='test'&&(input.ackFamily==='CONTRL'||commonTechnicalRead)
  ?{companyId,actorUserId:input.actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']}
  :{companyId,actorUserId:input.actorUserId,permission:'communication.write'})
 const existing=await findExistingAckForSource({sourceMessageId:source.id,ackFamily:input.ackFamily,
  ackScope:input.ackScope,acknowledgedReferences:input.acknowledgedReferences,acknowledgedProdatObjects:input.acknowledgedProdatObjects,expectedSource:source,expectedTechnicalCompanyId})
 const requested=input.ackFamily==='UTILTS_ERR'?'negative':input.outcome
 if(existing&&requested&&existing.ack_outcome!==requested)throw new Error('blocked_final_ack_exists: Originalets ACK-utfall är oföränderligt.')
 return existing
}
