import {supabaseService} from '@/lib/supabase/service'
import {readDatedSourceMeasurements} from './datedSourceMeasurements'
import {reviewedBusinessFor} from './structuralSourceReadset'
import {selectStructuralSources,type StructuralSelection} from './structuralSourceSelection'
import {prodatDate203,prodatMarketMinuteToUtc} from '@/lib/ediel/prodat/render/dates'
import {isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'

export type QualifiedCustomerStructure={status:'unavailable';reason:string}|{
 status:'selected';snapshotId:string;readsetHash:string;objectId:string;identityAgency:string;periodStart:string;periodEnd:string;
 selection:Extract<StructuralSelection,{status:'selected'}>;legalSupplier:string;legalNetwork:string;
 fields:{measurementMethod:string|null;reportingFrequency:string|null;productCode:string|null;settlementMethod:string|null};
}
export type DatedCustomerStructureRequest={companyId:string;customerId:string;siteId:string;meteringPointId:string;actorUserId:string;environment:'test'|'production';periodStart:string;periodEnd:string}
function marketInstant(value:string):string|null {const minute=prodatDate203(value);return minute?prodatMarketMinuteToUtc(minute):null}
/** Current scalar rows select the internal request scope only. The exact dated
 * meter/register/field values come from witnessed own-source versions, their
 * same-canonical P119 facets and the sole native current supply owner. */
export async function readQualifiedCustomerStructure(input:DatedCustomerStructureRequest):Promise<QualifiedCustomerStructure>{
 if(![input.companyId,input.customerId,input.siteId,input.meteringPointId,input.actorUserId].every(isEvidenceUuid))return {status:'unavailable',reason:'dated_structure_request_scope_invalid'}
 const periodStart=marketInstant(input.periodStart),periodEnd=marketInstant(input.periodEnd),cutoffAt=new Date().toISOString()
 if(!periodStart||!periodEnd||periodStart>periodEnd)return {status:'unavailable',reason:'dated_structure_request_period_invalid'}
 // No scalar fallback on failed or unavailable source reads.
 const readset=await readDatedSourceMeasurements({...input,cutoffAt})
 const candidates=readset.versions.flatMap(v=>{
  const own=reviewedBusinessFor(readset,v.sourceMessageId,v.wire.object)
  return own&&v.wire.businessCase==='supply_baseline'&&own.customerId===input.customerId&&own.siteId===input.siteId&&own.meteringPointId===input.meteringPointId&&v.coverage?[v]:[]
 })
 const selections:Extract<QualifiedCustomerStructure,{status:'selected'}>[]=[]
 const seen=new Set<string>()
 for(const v of candidates){
  const object=v.wire.object,key=JSON.stringify([object.objectId,object.identityAgency,v.coverage!.supplyPeriodId])
  if(seen.has(key)||!object.objectId||!object.identityAgency)continue;seen.add(key)
  const selected=selectStructuralSources({ledgerStartedAt:readset.timeline.ledgerStartedAt!,cutoffAt,readComplete:readset.timeline.boundedReadComplete,
   unresolvedSources:readset.unresolvedSources,versions:readset.versions,closures:readset.closures,closureBlockers:readset.closureBlockers,correctionContextBlockers:readset.correctionContextBlockers,
   companyId:input.companyId,environment:input.environment,customerId:input.customerId,supplyPeriodId:v.coverage!.supplyPeriodId,
   objectId:object.objectId,identityAgency:object.identityAgency,legalSender:v.wire.legalSender,legalReceiver:v.wire.legalReceiver,
   periodStart,periodEnd,boundary:periodStart===periodEnd?'current_point':'interval'})
  if(selected.status!=='selected'||selected.coverage.supplyPeriodId!==v.coverage!.supplyPeriodId)continue
  const {data:basis,error}=await supabaseService.rpc('ediel_read_source_supply_basis_v1',{p_company_id:input.companyId,p_actor_user_id:input.actorUserId,p_period_id:selected.coverage.supplyPeriodId,p_start:periodStart,p_end:periodEnd}).abortSignal(AbortSignal.timeout(2000))
  if(error)throw new Error('dated_structure_current_supply_basis_unconfirmed')
  if(!isEvidenceRecord(basis)||basis.qualified!==true||basis.customerId!==input.customerId||basis.siteId!==input.siteId||basis.meteringPointId!==input.meteringPointId||basis.initialSourceMessageId!==selected.coverage.baselineSourceMessageId)continue
  const field=(name:keyof QualifiedCustomerStructureFields):string|null=>{
   const values=selected.states.map(state=>state.measurements?.[name])
   return values.length&&values.every(value=>value?.sourceMessageId&&value.value!==null&&value.value===values[0]?.value)?values[0]!.value:null
  }
  selections.push({status:'selected',snapshotId:readset.timeline.snapshotId!,readsetHash:readset.timeline.readsetHash!,objectId:object.objectId,identityAgency:object.identityAgency,periodStart,periodEnd,selection:selected,legalSupplier:v.wire.legalReceiver,legalNetwork:v.wire.legalSender,
   fields:{measurementMethod:field('measurementMethod'),reportingFrequency:field('reportingFrequency'),productCode:field('productCode'),settlementMethod:field('settlementMethod')}})
 }
 return selections.length===1?selections[0]:{status:'unavailable',reason:selections.length?'dated_structure_owned_period_ambiguous':'dated_structure_owned_period_missing'}
}
type QualifiedCustomerStructureFields=Extract<QualifiedCustomerStructure,{status:'selected'}>['fields']
