import {supabaseService} from '@/lib/supabase/service'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

export type AiBiProcessingDecision = Readonly<{
  id:string; revision:number; companyId:string; listType:'AI'|'BI';
  purpose:'ediel_list_reconciliation'; gdprBasis:string; retentionDays:number;
  retentionUntil:string; sourceReference:string; sourceSha256:string;
  ownerRegistryId:string; ownerRegistryVersion:string;
}>

/** Reads a registered decision, never legal approval supplied by a caller.
 * The native owner gate remains held until the real versioned decision-owner
 * authority is integrated. No local default or test fixture can open it. */
export async function requireAiBiProcessingDecision(input:{companyId:string;actorUserId:string;listType:'AI'|'BI'}):Promise<AiBiProcessingDecision>{
  await assertEdielTenantActor({...input,permissionAnyOf:['communication.write','ediel_testing.write']})
  const {data,error}=await supabaseService.rpc('gridex_ai_bi_processing_decision_v1',{
    p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_list_type:input.listType,
  })
  if(error)throw error
  if(!data||data.status!=='authorized')throw new Error(typeof data?.blocker==='string'?data.blocker:'ai_bi_processing_decision_required')
  const decision=data.decision as AiBiProcessingDecision|undefined
  if(!decision||!isEvidenceUuid(decision.id)||decision.companyId!==input.companyId||decision.listType!==input.listType||decision.purpose!=='ediel_list_reconciliation'
    ||!Number.isSafeInteger(decision.revision)||decision.revision<1||!Number.isSafeInteger(decision.retentionDays)||decision.retentionDays<1
    ||typeof decision.gdprBasis!=='string'||!decision.gdprBasis.trim()||!/^\d{4}-\d{2}-\d{2}$/.test(decision.retentionUntil)
    ||typeof decision.sourceReference!=='string'||!decision.sourceReference.trim()||!/^[a-f0-9]{64}$/.test(decision.sourceSha256)
    ||!isEvidenceUuid(decision.ownerRegistryId)||typeof decision.ownerRegistryVersion!=='string'||!decision.ownerRegistryVersion.trim())throw new Error('ai_bi_processing_decision_invalid')
  return Object.freeze({...decision})
}
