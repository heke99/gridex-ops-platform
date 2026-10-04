import {supabaseService} from '@/lib/supabase/service'
import type {AiListHistoricalProjection,AiListHistoryScope} from '@/lib/ediel/aiListHistory'
import {reviewedBusinessFor,type StructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {prodatMarketMinuteToUtc} from '@/lib/ediel/prodat/render/dates'

/** An equality read for the SAME selected source history. It never chooses a
 * newer meter, register, date or customer from mutable masterdata. */
export async function requireAiListAppliedHistory(input:{actorUserId:string;scope:AiListHistoryScope;history:AiListHistoricalProjection;readset:StructuralReadset}):Promise<void>{
 const {scope,history,readset}=input
 if(readset.timeline.status!=='inspected'||readset.timeline.snapshotId!==history.evidence.snapshotId||readset.timeline.readsetHash!==history.evidence.readsetHash||readset.timeline.cutoffAt!==scope.cutoffAt)throw new Error('ai_list_applied_history_snapshot_unconfirmed')
 const checked=new Set<string>()
 for(let index=0;index<history.details.length;index++){
  const row=history.details[index],refs=history.evidence.rowSources[index]
  if(!refs)throw new Error('ai_list_applied_history_scope_incomplete')
  const at=prodatMarketMinuteToUtc(`${row.franDatum??scope.fromDate.replaceAll('-','')}0000`)
  if(!at)throw new Error('ai_list_applied_history_date_unqualified')
  for(const sourceId of new Set([refs.sourceMessageId,refs.baselineSourceMessageId,refs.addressSourceMessageId])){
   const key=JSON.stringify([sourceId,refs.supplyPeriodId,row.anlaggningsId,row.kodlista,at])
   if(checked.has(key))continue;checked.add(key)
   const version=readset.versions.find(item=>item.sourceMessageId===sourceId&&item.wire.object.objectId===row.anlaggningsId&&item.wire.object.identityAgency===row.kodlista)
   const business=version&&reviewedBusinessFor(readset,sourceId,version.wire.object)
   if(!version?.assessmentId||!business||business.companyId!==scope.companyId||business.environment!==scope.environment||business.customerId!==scope.customerId||business.siteId!==scope.siteId||business.supplyPeriodId!==refs.supplyPeriodId||scope.meteringPointId&&business.meteringPointId!==scope.meteringPointId)throw new Error('ai_list_applied_history_own_scope_unconfirmed')
   // The actual native normal supply owner qualifies the Z04 baseline in the
   // mandatory original row binder. Z06/Z10 require their own committed effect.
   if(version.wire.messageCode==='Z04')continue
   if(!business.meteringPointId)throw new Error('ai_list_applied_history_own_scope_unconfirmed')
   const {data,error}=await supabaseService.rpc('ediel_read_structural_effect_scope_v1',{p_company_id:scope.companyId,p_environment:scope.environment,p_actor_user_id:input.actorUserId,
    p_snapshot_id:history.evidence.snapshotId,p_readset_hash:history.evidence.readsetHash,p_customer_id:scope.customerId,p_site_id:scope.siteId,p_point_id:business.meteringPointId,p_period_id:refs.supplyPeriodId,
    p_at:at,p_source_message_id:sourceId,p_assessment_id:version.assessmentId,p_object_id:row.anlaggningsId,p_identity_agency:row.kodlista}).abortSignal(AbortSignal.timeout(2000))
   if(error||data?.applied!==true)throw new Error('ai_list_applied_structural_source_unconfirmed')
  }
 }
 if(history.details.length!==history.evidence.rowSources.length)throw new Error('ai_list_applied_history_scope_incomplete')
}
