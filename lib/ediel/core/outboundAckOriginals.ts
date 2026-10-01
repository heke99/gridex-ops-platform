import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import {readPhysicalAckSourceCorrelation,type InboundAckSourceCorrelation} from '@/lib/ediel/ack/sourceCorrelation'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {AckFamily} from './ackPolicy'

export type OutboundAckOriginal=Readonly<{status:'qualified'|'held';message:EdielMessageRow;correlation:InboundAckSourceCorrelation}>
/** Internal service read after the ACK gateway's actor/source access gate.
 * Protected born evidence supplies authority; public status/outcome does not.
 * This deliberately neither captures a missing basis nor selects today's pack. */
export async function readOutboundAckOriginals(sourceMessageId:string,ackFamily:AckFamily,expectedSource?:EdielMessageRow,expectedTechnicalCompanyId?:string,authorization?:{actorUserId:string;phase:'prepare'|'read'|'send'}):Promise<OutboundAckOriginal[]> {
 if(!authorization?.actorUserId||!['prepare','read','send'].includes(authorization.phase))throw new Error('ediel_existing_ack_original_current_actor_required')
 const {data,error}=await supabaseService.rpc('gridex_read_outbound_acks_for_source_v2',{p_source_message_id:sourceMessageId,p_ack_family:ackFamily,p_actor_user_id:authorization.actorUserId,p_phase:authorization.phase})
 const result=data as {version?:unknown;executionActorUserId?:unknown;executionPhase?:unknown;sourceMessageId?:unknown;sourcePayloadHash?:unknown;environment?:unknown;companyId?:unknown;originals?:unknown}|null
 if(error||!result||result.version!==2||result.executionActorUserId!==authorization.actorUserId||result.executionPhase!==authorization.phase||result.sourceMessageId!==sourceMessageId||typeof result.sourcePayloadHash!=='string'||!/^[a-f0-9]{64}$/.test(result.sourcePayloadHash)
  ||!['test','production'].includes(String(result.environment))||!Array.isArray(result.originals)) throw new Error('ediel_existing_ack_original_read_unavailable',{cause:error})
 if(expectedTechnicalCompanyId && (!expectedSource || expectedSource.company_id!==null))throw new Error('ediel_existing_ack_original_source_mismatch')
 if(expectedSource && (expectedSource.id!==sourceMessageId || expectedSource.direction!=='inbound' || (expectedSource.company_id??expectedTechnicalCompanyId)!==result.companyId || expectedSource.environment!==result.environment
  || !expectedSource.raw_payload || createHash('sha256').update(expectedSource.raw_payload,'utf8').digest('hex')!==result.sourcePayloadHash)) throw new Error('ediel_existing_ack_original_source_mismatch')
 return result.originals.map(candidate=>{
  const item=candidate as {status?:unknown;message?:EdielMessageRow;payloadHash?:unknown},m=item.message
  if(!m||!['qualified','held'].includes(String(item.status))||m.direction!=='outbound'||m.message_family!==ackFamily||m.company_id!==result.companyId||m.environment!==result.environment
   ||!m.raw_payload||createHash('sha256').update(m.raw_payload,'utf8').digest('hex')!==item.payloadHash) throw new Error('ediel_existing_ack_original_read_scope_invalid')
  const correlation=readPhysicalAckSourceCorrelation(m,expectedSource)
  if(correlation.classification.family!==ackFamily) throw new Error('ediel_existing_ack_original_read_scope_invalid')
  return Object.freeze({status:item.status as 'qualified'|'held',message:m,correlation})
 })
}
