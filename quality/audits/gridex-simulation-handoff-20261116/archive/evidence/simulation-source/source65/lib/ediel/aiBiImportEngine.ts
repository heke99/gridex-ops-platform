import {createHash} from 'node:crypto'
import {supabaseService} from '@/lib/supabase/service'
import {parseAiBiListCsv,type AiBiListType} from '@/lib/ediel/aiBiImportParser'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

/** Shared technical parsing is separate from native source-owned persistence.
 * Matching, investigation rows and the immutable source outcome are one native
 * transaction. Caller rows, point/customer matches or retention claims are never
 * passed as authority. First raw storage has its own legal-decision gate. */
export async function importAiBiListCsv(input:{companyId:string;listType:AiBiListType;rawCsv:string;filename?:string|null;gridOwnerId?:string|null;actorUserId?:string|null;sourceMessageId?:string|null}):Promise<{importId:string;rowCount:number;discrepancyCount:number}> {
  if(!input.actorUserId)throw new Error('ediel_tenant_actor_required')
  await assertEdielTenantActor({companyId:input.companyId,actorUserId:input.actorUserId,permissionAnyOf:['communication.write','ediel_testing.write']})
  const parsed=parseAiBiListCsv({raw:input.rawCsv,listType:input.listType})
  if(!isEvidenceUuid(input.sourceMessageId))throw new Error('ai_bi_reconciliation_sealed_source_required')
  const {data,error}=await supabaseService.rpc('gridex_ai_bi_reconcile_source_v1',{
    p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_source_message_id:input.sourceMessageId,
    p_source_payload_hash:createHash('sha256').update(input.rawCsv,'utf8').digest('hex'),
  })
  if(error)throw error
  const result=data as Record<string,unknown>|null
  if(result?.status==='held'&&typeof result.blocker==='string')throw new Error(result.blocker)
  if(result?.status!=='applied'||!isEvidenceUuid(result.importId)||result.rowCount!==parsed.rows.length||!Number.isSafeInteger(result.discrepancyCount)
    ||(result.discrepancyCount as number)<0||(result.discrepancyCount as number)>parsed.rows.length)throw new Error('ai_bi_reconciliation_result_invalid')
  return {importId:result.importId,rowCount:parsed.rows.length,discrepancyCount:result.discrepancyCount as number}
}
