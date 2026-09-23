import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation,takeReceivedSourceOwnerSeed} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {resolveCanonicalTenantEdielIdentityWithEvidence,assertInboundTransportMatchesTenantIdentity} from '@/lib/ediel/tenant/tenantEdielIdentity'
import {readSelectedFacilityEvidence} from './sourceOwnerReads'
import {findStructuralReviewPoint,readStructuralReviewRow,structuralReviewQuery} from './structuralReviewReads'
import {readStructuralSourceWire,type StructuralSourceWire} from './structuralSourceWire'
import {inspectStructuralReadset,type StructuralReadset} from './structuralSourceReadset'
import {isReviewedStructuralBusiness,type ReviewedStructuralBusiness} from './reviewedStructuralSource'
import {persistReceivedSourceOwnerDecisions,type SourceOwnerSeed,type SourceObjectDecision,type SourceOwnerReceipt} from './sourceOwnerPersistence'
import type {StructuralCoverage,StructuralReplacement} from './structuralSourceSelection'
import type {SourceObjectScope} from './sourceOwnerWire'

const instant=parseSourceReceiptInstant
const unconfirmed=():SourceOwnerReceipt=>({status:'unconfirmed',sourceDisposition:'not_established'})
function marketDay(value:unknown):string|null{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null
  // DATE values are already PostgreSQL validated; fixed normal time, not DST.
  const date=new Date(`${value}T00:00:00+01:00`)
  return Number.isFinite(date.getTime())?date.toISOString():null
}
function logicalScope(left:SourceObjectScope,right:SourceObjectScope){return left.objectId===right.objectId&&left.identityAgency===right.identityAgency}

type Anchor={source:StructuralReadset['sources'][number];business:Record<string,unknown>;rootId:string;rootHash:string;wire:StructuralSourceWire}
function anchors(readset:StructuralReadset,wire:StructuralSourceWire):Anchor[]{
  const result:Anchor[]=[]
  for(const source of readset.sources){
    if(!source.asOf)continue
    for(const entry of source.objects){
      if(entry.disposition!=='accepted'||!logicalScope(entry.object,wire.object))continue
      const baseline=readStructuralSourceWire(source.rawPayload,entry.object)
      if(!baseline||baseline.messageCode!=='Z04'||baseline.legalSender!==wire.legalSender||baseline.legalReceiver!==wire.legalReceiver
        ||instant(baseline.effectiveFrom.utc)!>instant(wire.effectiveFrom.utc)!)continue
      let rootId=source.asOf.assessmentId,rootHash=source.asOf.factsHash
      if(isReviewedStructuralBusiness(entry.business,source.rawPayload,entry.object)){
        if(entry.business.coverageWindow.baselineSourceMessageId!==source.sourceMessageId)continue
        rootId=entry.business.coverageWindow.baselineAssessmentId;rootHash=entry.business.coverageWindow.baselineFactsHash
      }
      const revision=readset.timeline.sources.find(item=>item.sourceMessageId===source.sourceMessageId)?.revisions
        .find(item=>item.assessmentId===rootId&&item.factsHash===rootHash&&item.availability==='witnessed_by_cutoff')
      const root=source.assessments.find(item=>item.id===rootId&&item.factsHash===rootHash)
      if(!revision||!root)continue
      const original=(JSON.parse(root.factsText) as {objects:SourceObjectDecision[]}).objects.find(item=>logicalScope(item.object,wire.object))
      if(original?.disposition==='accepted'&&original.business?.owner==='inbound-z04-switch-confirmation-v1'){
        result.push({source,business:original.business,rootId,rootHash,wire:baseline})
      }
    }
  }
  return result
}

async function resolveCoverage(seed:SourceOwnerSeed,wire:StructuralSourceWire,readset:StructuralReadset,point:Record<string,unknown>){
  const epoch=instant(readset.timeline.ledgerStartedAt),cutoff=instant(readset.timeline.cutoffAt)
  if(epoch===null||cutoff===null)throw new Error('structure_review_ledger_unknown')
  const eligible:{anchor:Anchor;coverage:StructuralCoverage}[]=[]
  for(const anchor of anchors(readset,wire)){
    const old=anchor.business
    if(old.meteringPointId!==point.id||old.siteId!==point.site_id||old.customerId!==point.customer_id
      ||!isEvidenceUuid(old.switchRequestId)||!isEvidenceUuid(old.supplyPeriodId))continue
    const sw=await readStructuralReviewRow('supplier_switch_requests',seed.evidence.companyId,old.switchRequestId)
    const sp=await readStructuralReviewRow('customer_supply_periods',seed.evidence.companyId,old.supplyPeriodId)
    if(sw.inbound_z04_message_id!==anchor.source.sourceMessageId||sp.source_message_id!==anchor.source.sourceMessageId
      ||sw.status!=='accepted'||sp.status!=='confirmed_by_grid_owner'||sw.customer_id!==point.customer_id||sp.customer_id!==point.customer_id
      ||sw.metering_point_id!==point.id||sp.metering_point_id!==point.id||sw.site_id!==point.site_id
      ||sp.source_switch_request_id!==null&&sp.source_switch_request_id!==sw.id||sw.confirmed_start_date!==sp.start_date
      ||sw.rff_li_reference!==anchor.wire.caseReference||!isEvidenceUuid(sw.outbound_z03_message_id))continue
    const start=marketDay(sp.start_date),end=sp.end_date===null?null:marketDay(sp.end_date)
    const created=instant(sw.created_at)
    if(!start||sp.end_date!==null&&!end||created===null||created<epoch||created>cutoff
      ||instant(start)!<epoch||created>instant(start)!||start!==anchor.wire.effectiveFrom.utc
      ||instant(wire.effectiveFrom.utc)!<instant(start)!||end!==null&&instant(wire.effectiveFrom.utc)!>=instant(end)!)continue
    const outbound=await readStructuralReviewRow('ediel_messages',seed.evidence.companyId,sw.outbound_z03_message_id)
    const sent=instant(outbound.message_sent_at),outboundCreated=instant(outbound.created_at)
    if(outbound.environment!==seed.evidence.environment||outbound.direction!=='outbound'||outbound.message_family!=='PRODAT'
      ||outbound.message_code!=='Z03'||outbound.message_standard!=='edifact'||outbound.metering_point_id!==point.id
      ||outbound.customer_id!==point.customer_id||outbound.site_id!==point.site_id||sent===null||outboundCreated===null
      ||outboundCreated<created||outboundCreated>cutoff||sent<outboundCreated||sent>instant(readset.timeline.sources.find(item=>item.sourceMessageId===anchor.source.sourceMessageId)?.receivedAt)!)continue
    eligible.push({anchor,coverage:{kind:'post_ledger_supply',baselineSourceMessageId:anchor.source.sourceMessageId,
      baselineAssessmentId:anchor.rootId,baselineFactsHash:anchor.rootHash,supplyPeriodId:String(sp.id),switchRequestId:String(sw.id),
      switchCreatedAt:String(sw.created_at),outboundSourceMessageId:String(outbound.id),outboundCreatedAt:String(outbound.created_at),validFrom:start,validTo:end}})
  }
  if(eligible.length!==1)throw new Error('structure_review_supply_ambiguous')
  return eligible[0]
}

function replacementFor(readset:StructuralReadset,wire:StructuralSourceWire,id:string|null,coverage:StructuralCoverage):StructuralReplacement|null{
  if(wire.functionCode!=='5'){
    if(id!==null)throw new Error('structure_review_original_has_replacement')
    return null
  }
  if(!isEvidenceUuid(id))throw new Error('structure_review_replacement_required')
  const source=readset.sources.find(item=>item.sourceMessageId===id)
  const object=source?.objects.find(item=>logicalScope(item.object,wire.object))
  if(!source?.asOf||object?.disposition!=='accepted'||!isReviewedStructuralBusiness(object.business,source.rawPayload,object.object))throw new Error('structure_review_replacement_unapproved')
  const prior=object.business
  if(prior.wire.messageCode!==wire.messageCode||prior.wire.businessCase!==wire.businessCase||prior.wire.caseReference!==wire.caseReference
    ||prior.wire.documentReference===wire.documentReference||prior.wire.legalSender!==wire.legalSender||prior.wire.legalReceiver!==wire.legalReceiver
    ||prior.supplyPeriodId!==coverage.supplyPeriodId)throw new Error('structure_review_replacement_scope')
  return {sourceMessageId:id,assessmentId:source.asOf.assessmentId,payloadHash:source.payloadHash}
}

/** Separate, explicit review of the complete ORIGINAL message. It neither
 * invokes partial safe-apply nor sends ACKs/market messages. Every accepted
 * object has fresh canonical validation, exact live party/point owners, an
 * already committed Z04 lifecycle anchor and SQL-checked reviewer permission. */
export async function reviewReceivedStructuralSource(input:{companyId:string;environment:'test'|'production';sourceMessageId:string;
  reviewerUserId:string;confirmedOriginal:boolean;replacesSourceMessageId:string|null}):Promise<SourceOwnerReceipt>{
  if(!input.confirmedOriginal||![input.companyId,input.sourceMessageId,input.reviewerUserId].every(isEvidenceUuid)
    ||input.replacesSourceMessageId!==null&&!isEvidenceUuid(input.replacesSourceMessageId))return unconfirmed()
  try{
    // Authorization precedes even canonical-ledger writes; SQL rechecks it at
    // composition commit. The service role is not a substitute for a reviewer.
    const permissions=await Promise.all(['communication.write','ediel_testing.write'].map(async permission=>{
      const {data,error}=await supabaseService.rpc('gridex_actor_has_company_permission',{
        p_actor_user_id:input.reviewerUserId,p_company_id:input.companyId,p_permission:permission,
      }).abortSignal(AbortSignal.timeout(2000))
      return !error&&data===true
    }))
    if(!permissions.some(Boolean))return unconfirmed()
    const {data,error}=await structuralReviewQuery(input.companyId,'ediel_messages','*').eq('id',input.sourceMessageId).eq('environment',input.environment).abortSignal(AbortSignal.timeout(2000)).maybeSingle()
    if(error||!data)return unconfirmed()
    const original=data as EdielMessageRow
    if(original.direction!=='inbound'||original.message_family!=='PRODAT'||original.message_standard!=='edifact'
      ||!['Z04','Z06','Z10'].includes(original.message_code??''))return unconfirmed()
    const decision=await resolveCanonicalRuntimeDecisionWithRegistry(original)
    const canonicalReceipt=await recordReceivedSourceValidation({original,validated:original,resolvedCompanyId:input.companyId,decision})
    const seed=takeReceivedSourceOwnerSeed(canonicalReceipt)
    if(!seed||!original.raw_payload)return unconfirmed()
    const canonical=JSON.parse(seed.evidence.factsText) as Record<string,unknown>
    const register=bindReceivedRegisterValidation(canonical.registerValidation,original.raw_payload)
    if(!register?.objects.length||register.objects.length>16)return unconfirmed()
    const cutoffAt=new Date().toISOString()
    const {data:snapshot,error:snapshotError}=await supabaseService.rpc('gridex_source_object_snapshot_v1',{
      p_company_id:input.companyId,p_environment:input.environment,p_cutoff:cutoffAt,
    }).abortSignal(AbortSignal.timeout(2000))
    if(snapshotError)return unconfirmed()
    const readset=inspectStructuralReadset({companyId:input.companyId,environment:input.environment,cutoffAt},snapshot)
    if(readset.timeline.status!=='inspected'||!readset.timeline.boundedReadComplete)return unconfirmed()
    const ready=[canonical.syntaxDecision,canonical.applicationDecision,canonical.functionalDecision].every(value=>value==='accepted')
    const rejected=[canonical.syntaxDecision,canonical.applicationDecision,canonical.functionalDecision].includes('rejected')
    const objects:SourceObjectDecision[]=[]
    for(const {disposition,reasons,...object} of register.objects){
      let result:SourceObjectDecision={object,disposition:rejected||disposition==='rejected'?'rejected':'unavailable',
        reasons:rejected?['canonical_rejected']:disposition==='rejected'?reasons:['structural_review_owner_unavailable'],business:null,party:null}
      if(ready&&disposition==='accepted'&&object.identityAgency==='9'&&object.messageIndex===0){
        try{
          const wire=readStructuralSourceWire(original.raw_payload,object)
          if(!wire||!object.objectId)throw new Error('structural_wire_unavailable')
          // P26.A permits Z06/E34 for death or a counterparty-specific bilateral
          // customer update. Neither owner is persisted/qualified here. Canonical
          // syntax or an incoming Z41 value cannot establish that authority.
          if(wire.businessCase==='customer_only')throw new Error('structural_e34_context_unavailable')
          const assessedAt=new Date().toISOString()
          const point=await findStructuralReviewPoint(input.companyId,object.objectId)
          const receiver=await resolveCanonicalTenantEdielIdentityWithEvidence({companyId:input.companyId,environment:input.environment,asOf:assessedAt,requireExactCounts:true})
          assertInboundTransportMatchesTenantIdentity({identity:receiver.identity,unbReceiverEdielId:wire.transportReceiver})
          if(receiver.identity.legalEdielId!==wire.legalReceiver||!receiver.identity.roleCodes.includes('electricity_supplier')
            ||receiver.evidence.records.transportIdentifiers.some(row=>row.is_verified!==true))throw new Error('structural_party_unavailable')
          const facility=await readSelectedFacilityEvidence({companyId:input.companyId,environment:input.environment,
            meteringPointId:String(point.id),siteId:String(point.site_id),objectId:object.objectId,signal:AbortSignal.timeout(5000)})
          if(facility.gridOwner.ediel_id!==wire.legalSender)throw new Error('structural_sender_unavailable')
          const {anchor,coverage}=await resolveCoverage(seed,wire,readset,point)
          if(wire.messageCode==='Z04'&&wire.functionCode!=='5'&&anchor.source.sourceMessageId!==input.sourceMessageId)throw new Error('structural_z04_commit_missing')
          const replaces=replacementFor(readset,wire,input.replacesSourceMessageId,coverage)
          if(replaces?.sourceMessageId===input.sourceMessageId)throw new Error('structural_self_replacement')
          const business:ReviewedStructuralBusiness={version:1,owner:'reviewed-received-structure-v1',coverage:'reviewed_post_ledger_supply',
            sourceDisposition:'not_established',businessDisposition:'reviewed',graphNamespace:'legacy_unqualified',
            sourceMessageId:input.sourceMessageId,sourcePayloadHash:seed.evidence.sourcePayloadHash,sourceReceivedAt:original.message_received_at!,
            companyId:input.companyId,environment:input.environment,object,assessedAt,wire,reviewerUserId:input.reviewerUserId,
            reviewStatement:'original_structural_message',customerId:String(point.customer_id),meteringPointId:String(point.id),siteId:String(point.site_id),
            switchRequestId:coverage.switchRequestId,supplyPeriodId:coverage.supplyPeriodId,coverageWindow:coverage,
            baselineCurrentAssessmentId:anchor.source.asOf!.assessmentId,
            reviewSnapshot:{snapshotId:readset.timeline.snapshotId!,readsetHash:readset.timeline.readsetHash!,cutoffAt},replaces}
          if(!isReviewedStructuralBusiness(business,original.raw_payload,object))throw new Error('structural_review_marker_invalid')
          const party={version:1,owner:'received-source-party-binding-v1',ruleVersion:'1',source:{sourceMessageId:input.sourceMessageId,
            sourcePayloadHash:seed.evidence.sourcePayloadHash,companyId:input.companyId,environment:input.environment,receivedAt:original.message_received_at},
            object,assessedAt,completedAt:new Date().toISOString(),historicalKnowledge:'not_established',authentication:'not_assessed',
            disposition:'accepted',reasons:[],receiver,facility,parties:{legalSender:wire.legalSender,legalReceiver:wire.legalReceiver,
              transportSender:wire.transportSender,transportReceiver:wire.transportReceiver}}
          result={object,disposition:'accepted',reasons:[],business,party}
        }catch{/* Every physical object stays represented; no partial promotion. */}
      }
      objects.push(result)
    }
    return persistReceivedSourceOwnerDecisions(seed,objects)
  }catch{return unconfirmed()}
}
