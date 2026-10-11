import {isDeepStrictEqual} from 'node:util'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {readReceivedProdatFinalResponsePlan} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import {inspectStructuralReadset,reviewedBusinessFor} from './structuralSourceReadset'
import {selectStructuralSources,type StructuralSelectionInput} from './structuralSourceSelection'

const qualifiedRefusals=new WeakSet<Error>()
function refuseMeterExchange():never {
 const error=new Error('structural_meter_exchange_unresolved')
 qualifiedRefusals.add(error)
 throw error
}
/** Only this checked comparison can request pending review. An RPC/transport
 * exception with similar text cannot masquerade as a business refusal. */
export function isReceivedProdatMeterExchangeRefusal(error:unknown):error is Error {
 return error instanceof Error&&qualifiedRefusals.has(error)
}

/** Prospective refusal guard for the public Z10 apply path. It confers no
 * accepted-source capability: the existing native owner still revalidates and
 * commits. The snapshot/commit race and direct RPC clients need a separate
 * atomic database guard; this preflight does not establish that closure. */
export async function guardReceivedProdatMeterExchangeApply(message:EdielMessageRow,objectLineIndices?:readonly number[]):Promise<void> {
 if(message.message_code!=='Z10')return
 if(!message.company_id||message.direction!=='inbound'||message.message_family!=='PRODAT'
  ||message.message_standard!=='edifact'||!message.raw_payload||!['test','production'].includes(message.environment))
  throw new Error('structural_apply_source_required')
 if(objectLineIndices&&(!objectLineIndices.length||objectLineIndices.some(n=>!Number.isSafeInteger(n)||n<0)
  ||new Set(objectLineIndices).size!==objectLineIndices.length))throw new Error('structural_apply_requested_scope_invalid')

 // Read sealed original effects before prospective inventory. Preserve retry
 // even if later structure is unavailable; never borrow a sibling's receipt.
 const committed=await readReceivedProdatFinalResponsePlan({companyId:message.company_id,sourceMessageId:message.id,rawPayload:message.raw_payload})
 const applied=new Set(committed?.plans.filter(plan=>plan.effectKind==='structural').flatMap(plan=>[...plan.objectLineIndices])??[])
 if(objectLineIndices?objectLineIndices.every(index=>applied.has(index))
  :committed&&applied.size===committed.totalObjectCount)return

 const cutoffAt=new Date().toISOString()
 const {data,error}=await supabaseService.rpc('gridex_source_object_snapshot_v1',{
  p_company_id:message.company_id,p_environment:message.environment,p_cutoff:cutoffAt,
 }).abortSignal(AbortSignal.timeout(3000))
 if(error)throw error
 const readset=inspectStructuralReadset({companyId:message.company_id,environment:message.environment,cutoffAt},data)
 if(readset.timeline.status!=='inspected'||!readset.timeline.boundedReadComplete||readset.unresolvedSources
  ||!readset.timeline.ledgerStartedAt)throw new Error('structural_apply_snapshot_unavailable')
 const source=readset.sources.find(row=>row.sourceMessageId===message.id)
 if(!source?.asOf||source.rawPayload!==message.raw_payload||source.payloadHash!==evidenceHash(message.raw_payload))
  throw new Error('structural_apply_original_review_required')
 const indices=source.objects.map(entry=>entry.object.registers[0]?.segmentIndex)
 if(objectLineIndices?.some(index=>!indices.includes(index)))throw new Error('structural_apply_requested_scope_invalid')

 for(const entry of source.objects){
  const index=entry.object.registers[0]?.segmentIndex
  if(index===undefined||applied.has(index)||objectLineIndices&&!objectLineIndices.includes(index)||entry.disposition!=='accepted')continue
  const business=reviewedBusinessFor(readset,message.id,entry.object)
  if(!business||business.wire.businessCase!=='meter_exchange'||business.companyId!==message.company_id
   ||business.environment!==message.environment||business.sourcePayloadHash!==source.payloadHash)
   throw new Error('structural_apply_original_review_required')
  const wire=business.wire
  const input:StructuralSelectionInput={ledgerStartedAt:readset.timeline.ledgerStartedAt,cutoffAt,readComplete:true,
   versions:readset.versions,closures:readset.closures,closureBlockers:readset.closureBlockers,
   correctionContextBlockers:readset.correctionContextBlockers,unresolvedSources:readset.unresolvedSources,
   companyId:message.company_id,environment:message.environment,customerId:business.customerId,supplyPeriodId:business.supplyPeriodId,
   objectId:entry.object.objectId!,identityAgency:entry.object.identityAgency!,legalSender:wire.legalSender,legalReceiver:wire.legalReceiver,
   periodStart:wire.effectiveFrom.utc,periodEnd:wire.effectiveFrom.utc,boundary:'closing_point'}
  // Closing-point excludes the candidate from the state, while retaining the
  // complete replacement graph. Dropping it from versions would incorrectly
  // revive the superseded exchange for a valid function-5 correction.
  const prior=selectStructuralSources(input)
  if(prior.status!=='selected')throw new Error('structural_apply_predecessor_unavailable:'+prior.reason)
  const covered=prior.coverage,expected=business.coverageWindow
  if(!isDeepStrictEqual([covered.supplyPeriodId,covered.baselineSourceMessageId,covered.baselineAssessmentId,covered.baselineFactsHash],
   [expected.supplyPeriodId,expected.baselineSourceMessageId,expected.baselineAssessmentId,expected.baselineFactsHash]))
   throw new Error('structural_apply_predecessor_scope_mismatch')
  const before=prior.states.at(-1)
  if(!before?.meterNumber)throw new Error('structural_apply_predecessor_unavailable')
  if(!wire.meterNumber||wire.meterNumber===before.meterNumber||wire.oldMeterNumber!==null&&wire.oldMeterNumber!==before.meterNumber)
   refuseMeterExchange()
  const current=selectStructuralSources({...input,boundary:'current_point'})
  if(current.status!=='selected'){
   if(current.reason==='structural_meter_exchange_unresolved')refuseMeterExchange()
   throw new Error('structural_apply_current_selection_unavailable:'+current.reason)
  }
  if(current.states.at(-1)?.sourceMessageId!==message.id)throw new Error('structural_apply_current_source_unavailable')
 }
}
