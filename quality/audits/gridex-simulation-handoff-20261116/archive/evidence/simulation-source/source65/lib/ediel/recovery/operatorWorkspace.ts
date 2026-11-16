import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import { isEvidenceRecord, isEvidenceUuid } from '@/lib/ediel/utilts/durableSourceDiscovery'
import { businessAckStatusPresentation, readBusinessAckStatusForDisplay } from '@/lib/ediel/inbound/businessAckReadModel'

export type RecoveryRecord={messageId:string;operationId:string|null;originalMessageId:string|null;environment:'test'|'production';status:string;code:string|null;rawPayload:string|null;payloadHash:string|null;contentCurrent:boolean;sourceCurrent:'qualified'|'held'|'not_applicable';ack:ReturnType<typeof businessAckStatusPresentation>}
type Choice={id:string;environment:'test'|'production';label:string}
export type RecoveryWorkspaceSnapshot={originals:Choice[];acks:Choice[];corrections:(Choice&{status:string})[];attempts:{id:string;messageId:string;label:string}[];record:RecoveryRecord|null}

/** The private native journal owns transport evidence. Discovery labels and
 * selected IDs are observations; the common command independently qualifies
 * the current source, actor and existing private operation at execution. */
export async function readProdatRecoveryWorkspace(input:{companyId:string;actorUserId:string;messageId?:string}):Promise<RecoveryWorkspaceSnapshot>{
  if(![input.companyId,input.actorUserId].every(isEvidenceUuid)||input.messageId!==undefined&&!isEvidenceUuid(input.messageId))throw Error('recovery_workspace_scope_required')
  const rpc=supabaseService.rpc.bind(supabaseService) as unknown as(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>
  const{data,error}=await rpc('ediel_prodat_recovery_workspace_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_message_id:input.messageId??null})
  if(error)throw error
  if(!isEvidenceRecord(data)||data.companyId!==input.companyId||data.actorUserId!==input.actorUserId)throw Error('recovery_workspace_result_invalid')
  for(const key of ['originals','acks','corrections','attempts']){
    const rows=data[key]
    if(!Array.isArray(rows)||rows.length>200||rows.some(r=>!isEvidenceRecord(r)||!isEvidenceUuid(r.id)||typeof r.label!=='string'||key==='attempts'&&!isEvidenceUuid(r.messageId)||key!=='attempts'&&!['test','production'].includes(String(r.environment))||key==='corrections'&&typeof r.status!=='string'))throw Error('recovery_workspace_result_invalid')
  }
  const r=data.record
  if(input.messageId===undefined?r!==null:!isEvidenceRecord(r)||r.messageId!==input.messageId)throw Error('recovery_workspace_record_invalid')
  if(isEvidenceRecord(r)){
    if(!['test','production'].includes(String(r.environment))||typeof r.status!=='string'||typeof r.contentCurrent!=='boolean'||!['qualified','held','not_applicable'].includes(String(r.sourceCurrent))
      ||r.operationId!==null&&!isEvidenceUuid(r.operationId)||r.originalMessageId!==null&&!isEvidenceUuid(r.originalMessageId)
      ||r.contentCurrent&&(typeof r.rawPayload!=='string'||!r.rawPayload||typeof r.payloadHash!=='string'||r.payloadHash!==createHash('sha256').update(r.rawPayload,'utf8').digest('hex'))
      ||!r.contentCurrent&&r.rawPayload!==null)throw Error('recovery_workspace_record_invalid')
  }
  let record:RecoveryRecord|null=null
  if(isEvidenceRecord(r)){
    // The shared current native ACK reader qualifies immutable receipts and
    // reconstructs the family status. Workspace cache columns are discarded.
    const ackStatus=await readBusinessAckStatusForDisplay({companyId:input.companyId,actorUserId:input.actorUserId,sourceMessageId:r.messageId as string,environment:r.environment as string})
    const ack=businessAckStatusPresentation(ackStatus),unavailable='holdReason' in ackStatus
    record={messageId:r.messageId as string,operationId:r.operationId as string|null,originalMessageId:r.originalMessageId as string|null,environment:r.environment as RecoveryRecord['environment'],status:r.status as string,code:r.code as string|null,
      rawPayload:unavailable?null:r.rawPayload as string|null,payloadHash:r.payloadHash as string|null,contentCurrent:!unavailable&&r.contentCurrent as boolean,sourceCurrent:r.sourceCurrent as RecoveryRecord['sourceCurrent'],ack}
  }
  return {...data,record} as unknown as RecoveryWorkspaceSnapshot
}
