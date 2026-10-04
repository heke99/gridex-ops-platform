import { createHash } from 'node:crypto'
import { supabaseService } from '@/lib/supabase/service'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { ExpectedContext } from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import { loadTgtReportingValidationContext } from '@/lib/ediel/testing/tgtReportingPermissionContext'
import { loadServiceReportingRecoveryContext } from '@/lib/ediel/services/reporting'
import { readRecoveryOperationBasis,readRecoveryOriginalBasis,type RecoverySourceBasis } from './sourceContext'

function permissionScope(context: ExpectedContext, basis: RecoverySourceBasis): ExpectedContext {
  const objects=context.objects.filter(o=>basis.allowedObjects.some(a=>a.point===null&&a.li===o.li&&a.customerIdentity===o.customer.id&&a.reason===o.expectedReason))
  if (!objects.length || basis.allowedObjects.some(a=>!objects.some(o=>a.point===null&&a.li===o.li&&a.customerIdentity===o.customer.id&&a.reason===o.expectedReason))) throw new Error('prodat_recovery_reporting_scope_unqualified')
  return {...context,objects}
}
async function original(companyId:string,id:string):Promise<EdielMessageRow>{
  const {data,error}=await supabaseService.from('ediel_messages').select('*').eq('company_id',companyId).eq('id',id).maybeSingle()
  if(error)throw error
  if(!data||data.company_id!==companyId||data.id!==id||data.direction!=='outbound'||data.message_family!=='PRODAT')throw new Error('prodat_recovery_reporting_original_unavailable')
  return data as EdielMessageRow
}
/** Pre-insert and every send/replay use current protected source adapters. An
 * undefined context on a qualified Z13 correction is held, never a fallback to
 * the original's mutable payload facts or a caller-supplied source selector. */
export async function loadRecoveryReportingContext(input:{companyId:string;operationId:string;actorUserId:string;phase?:'prepare'|'send'}):Promise<{originalMessage:EdielMessageRow;context:ExpectedContext|undefined}> {
  const basis=await readRecoveryOperationBasis(input)
  if(!basis)throw new Error('prodat_recovery_reporting_operation_unqualified')
  const originalMessage=await original(input.companyId,basis.originalMessageId)
  if(originalMessage.message_code!=='Z13')return {originalMessage,context:undefined}
  const service=await loadServiceReportingRecoveryContext({...input,phase:input.phase??'prepare'})
  if(service){
    if(service.originalMessage.id!==originalMessage.id)throw new Error('prodat_recovery_reporting_original_conflict')
    return {originalMessage,context:permissionScope(service.context,basis)}
  }
  const sourceOriginal=basis.sourceOriginMessageId===originalMessage.id?originalMessage:await original(input.companyId,basis.sourceOriginMessageId)
  if(sourceOriginal.environment!==originalMessage.environment||sourceOriginal.message_code!==originalMessage.message_code)throw new Error('prodat_recovery_reporting_source_origin_scope')
  const tgt=await loadTgtReportingValidationContext(sourceOriginal)
  if(!tgt)throw new Error('prodat_recovery_reporting_current_source_unavailable')
  return {originalMessage,context:permissionScope(tgt,basis)}
}
export async function loadRecoveryReportingValidationContext(message:EdielMessageRow,actorUserId:string):Promise<{status:'qualified';context:ExpectedContext|undefined}|undefined>{
  if(!message.company_id||message.direction!=='outbound'||message.message_family!=='PRODAT'||!['Z13','Z18'].includes(message.message_code))return undefined
  const basis=await readRecoveryOriginalBasis({companyId:message.company_id,messageId:message.id,actorUserId})
  if(!basis)return undefined
  if(basis.operationId!==message.source_operation_id||basis.originalMessageId!==message.original_message_id||!message.raw_payload||basis.correctedPayloadHash!==createHash('sha256').update(message.raw_payload,'utf8').digest('hex'))throw new Error('prodat_recovery_reporting_message_scope')
  const current=await loadRecoveryReportingContext({companyId:message.company_id,operationId:basis.operationId,actorUserId,phase:'send'})
  if(current.originalMessage.environment!==message.environment||current.originalMessage.message_code!==message.message_code)throw new Error('prodat_recovery_reporting_original_scope')
  return {status:'qualified',context:current.context}
}
