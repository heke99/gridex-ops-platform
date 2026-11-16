import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {EdielAperakApplicationError} from '@/lib/ediel/ack'
import type {SourceSwitchCommitObserver} from './sourceSwitchCommit'
import {publishSourceSwitchCommit} from './sourceSwitchCommit'
import {evidenceHash,isEvidenceRecord} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {isQualifiedProdatApplicationError} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>

/** The caller supplies source identity only. The native owner reads full-guide
 * facets, rechecks actor/tenant/legal source and commits exact owned Z03/contract
 * scopes before exposing positive outcomes. Nothing mutates the original wire. */
export async function processMixedProdatObjects(input:{actorUserId:string;message:EdielMessageRow;
  negativeErrors:readonly EdielAperakApplicationError[];onSourceSwitchCommitted?:SourceSwitchCommitObserver}):Promise<EdielAperakApplicationError[]|null>{
 if(input.message.direction!=='inbound'||input.message.message_family!=='PRODAT'||input.message.message_code!=='Z04'
   ||!input.message.company_id||!input.message.raw_payload||!input.negativeErrors.length||!input.negativeErrors.every(isQualifiedProdatApplicationError))return null
 let data:unknown
 try{
  const response=await (supabaseService.rpc.bind(supabaseService) as unknown as Rpc)('ediel_read_prodat_mixed_reply_v1',{
   p_company_id:input.message.company_id,p_source_message_id:input.message.id,p_actor_user_id:input.actorUserId})
  if(response.error)return null
  data=response.data
 }catch{return null}
 if(!isEvidenceRecord(data)||data.applied!==true)return null
 if(data.sourceMessageId!==input.message.id||data.companyId!==input.message.company_id||data.environment!==input.message.environment
   ||data.sourcePayloadHash!==evidenceHash(input.message.raw_payload)||!Array.isArray(data.processedObjects)||!Array.isArray(data.commits))throw new Error('prodat_mixed_commit_receipt_scope_conflict')
 const wire=tokenizeEdifact(input.message.raw_payload),physical=prodatRegisterGroups(wire.segments,wire.una).groups.filter(g=>g.registerPosition===1)
 if(physical.length!==data.processedObjects.length)throw new Error('prodat_mixed_commit_receipt_incomplete')
 const positives:EdielAperakApplicationError[]=[]
 for(const group of physical){
  const refs=group.segments.filter(t=>t.tag==='RFF'&&segmentComposite(t,1,wire.una)[0]==='LI'),li=refs.length===1?segmentComposite(refs[0],1,wire.una)[1]:null
  const matches=data.processedObjects.filter((o:unknown)=>isEvidenceRecord(o)&&o.objectId===group.itemId&&o.identityAgency===group.identityAgency&&o.firstLineIndex===group.lineIndex&&o.lineItemReference===li)
  if(matches.length!==1||!isEvidenceRecord(matches[0]))throw new Error('prodat_mixed_commit_receipt_own_scope_conflict')
  const own=matches[0]
  if(own.disposition==='accepted')positives.push({ercCode:'100',fieldCode:null,text:'OK',referenceQualifier:group.itemId?'Z07':null,referenceNumber:group.itemId,lineItemReference:li})
  else if(own.disposition!=='rejected'||!input.negativeErrors.some(e=>e.referenceNumber===group.itemId&&e.lineItemReference===li))throw new Error('prodat_mixed_commit_receipt_outcome_missing')
 }
 if(!positives.length||data.commits.length!==positives.length)throw new Error('prodat_mixed_commit_receipt_actual_effect_required')
 // Branded local handoff grants the existing source-owner composition access
 // only to the exact native committed scope; it is never caller JSON approval.
 for(const commit of data.commits){
  if(!isEvidenceRecord(commit)||['switchRequestId','supplyPeriodId','customerId','meteringPointId','siteId'].some(key=>typeof commit[key]!=='string'||!commit[key]))throw new Error('prodat_mixed_commit_receipt_actual_scope_required')
  await publishSourceSwitchCommit(input.onSourceSwitchCommitted,{message:{...input.message,customer_id:String(commit.customerId),metering_point_id:String(commit.meteringPointId),site_id:String(commit.siteId)},switchRequestId:String(commit.switchRequestId),supplyPeriodId:String(commit.supplyPeriodId)})
 }
 return [...input.negativeErrors,...positives]
}

/** Mark the immutable reply intent consumed only after the shared ACK writer
 * has persisted its genuine own-outcome wire and actual dispatch outbox. */
export async function consumeMixedProdatReply(input:{actorUserId:string;message:EdielMessageRow;acknowledgementIds:readonly string[]}):Promise<void>{
 for(const id of input.acknowledgementIds){
  const {data,error}=await (supabaseService.rpc.bind(supabaseService) as unknown as Rpc)('ediel_consume_prodat_mixed_reply_v1',{
   p_company_id:input.message.company_id,p_source_message_id:input.message.id,p_acknowledgement_id:id,p_actor_user_id:input.actorUserId})
  // Technical CONTRL does not consume an own application-outcome intent.
  if(error)continue
  if(isEvidenceRecord(data)&&data.consumed===true&&data.acknowledgementId===id)return
 }
 throw new Error('prodat_mixed_reply_actual_ack_not_consumed')
}
