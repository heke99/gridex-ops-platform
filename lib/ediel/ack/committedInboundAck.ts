import {supabaseService} from '@/lib/supabase/service'
import {evidenceHash,isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {EdielMessageRow} from '@/lib/ediel/types'

type ScopeOutcome={reference:string;outcome:'positive'|'negative'}
export type CommittedInboundAck =
 | {kind:'exact_receipt';sourceMessageId:string;result:{version:1;sourceMessage:EdielMessageRow;outcome:'positive'|'negative';scope:string;scopeOutcomes:ScopeOutcome[];finalAckReached:boolean;wholeSourceRejected:boolean;sourceAccepted:boolean;failureReason:string|null;idempotent:boolean}}
 | {kind:'legacy_diagnostic';sourceMessageId:string;outcome:'positive'|'negative';scope:string;scopeOutcomes:ScopeOutcome[];summaryUnavailable:true}

/** Read an existing immutable own-source proof before any contemporary tenant,
 * guide or status projection. No row metadata can manufacture this receipt. */
export async function readCommittedInboundAck(input:{actorUserId:string;message:EdielMessageRow}):Promise<CommittedInboundAck|null> {
 const {message}=input
 if(!['CONTRL','APERAK','UTILTS_ERR'].includes(message.message_family)) return null
 if(message.direction!=='inbound' || !isEvidenceUuid(message.company_id) || !isEvidenceUuid(message.id) || !message.raw_payload || !isEvidenceUuid(input.actorUserId)) throw new Error('ack_committed_read_scope_required')
 const {data,error}=await supabaseService.rpc('gridex_read_committed_inbound_ack_v1',{p_company_id:message.company_id,p_environment:message.environment,p_ack_message_id:message.id,p_actor_user_id:input.actorUserId})
 if(error) throw error
 if(data===null) return null
 if(!isEvidenceRecord(data) || data.ackFamily!==message.message_family || data.ackMessageId!==message.id || data.companyId!==message.company_id || data.environment!==message.environment
  || data.ackPayloadHash!==evidenceHash(message.raw_payload) || !isEvidenceUuid(data.sourceMessageId)) throw new Error('ack_committed_read_invalid')
 const summary=data.kind==='exact_receipt' ? data.result : data
 if(!isEvidenceRecord(summary) || !['positive','negative'].includes(String(summary.outcome)) || !['interchange','message','transaction','object'].includes(String(summary.scope))
  || !Array.isArray(summary.scopeOutcomes) || summary.scopeOutcomes.some(item=>!isEvidenceRecord(item) || typeof item.reference!=='string' || !['positive','negative'].includes(String(item.outcome)))) throw new Error('ack_committed_read_invalid')
 if(data.kind==='legacy_diagnostic' && data.summaryUnavailable===true) return Object.freeze(data) as CommittedInboundAck
 if(data.kind!=='exact_receipt' || summary.version!==1 || !isEvidenceRecord(summary.sourceMessage)
  || summary.sourceMessage.id!==data.sourceMessageId || summary.sourceMessage.company_id!==message.company_id || summary.sourceMessage.environment!==message.environment || summary.sourceMessage.direction!=='outbound'
  || ![summary.finalAckReached,summary.wholeSourceRejected,summary.sourceAccepted,summary.idempotent].every(item=>typeof item==='boolean')
  || !(summary.failureReason===null || typeof summary.failureReason==='string')) throw new Error('ack_committed_read_invalid')
 return Object.freeze(data) as CommittedInboundAck
}
