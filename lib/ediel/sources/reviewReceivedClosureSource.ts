import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {recordReceivedSourceValidation,takeReceivedSourceOwnerSeed} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {resolveCanonicalTenantEdielIdentityWithEvidence,assertInboundTransportMatchesTenantIdentity} from '@/lib/ediel/tenant/tenantEdielIdentity'
import {readSelectedFacilityEvidence} from './sourceOwnerReads'
import {findStructuralReviewPoint,structuralReviewQuery} from './structuralReviewReads'
import {readClosureSourceWire} from './closureSourceWire'
import {resolveClosureCoverage} from './closureReviewCoverage'
import {inspectStructuralReadset} from './structuralSourceReadset'
import {isReviewedClosureBusiness,type ReviewedClosureBusiness} from './reviewedClosureSource'
import {persistReceivedSourceOwnerDecisions,type SourceObjectDecision,type SourceOwnerReceipt} from './sourceOwnerPersistence'

const unconfirmed=():SourceOwnerReceipt=>({status:'unconfirmed',sourceDisposition:'not_established'})
/** Separate, explicit review of the complete ORIGINAL message. It neither
 * invokes partial safe-apply nor sends ACKs/market messages. Every accepted
 * object has fresh canonical validation, exact live party/point owners, an
 * already witnessed reviewed Z04 coverage and committed root and SQL-checked reviewer permission. */
export async function reviewReceivedClosureSource(input:{companyId:string;environment:'test'|'production';sourceMessageId:string;
  reviewerUserId:string;confirmedOriginal:boolean}):Promise<SourceOwnerReceipt>{
  if(!input.confirmedOriginal||(input.environment!=='test'&&input.environment!=='production')||![input.companyId,input.sourceMessageId,input.reviewerUserId].every(isEvidenceUuid))return unconfirmed()
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
      ||original.message_code!=='Z05')return unconfirmed()
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
        reasons:rejected?['canonical_rejected']:disposition==='rejected'?reasons:['closure_review_owner_unavailable'],business:null,party:null}
      if(ready&&disposition==='accepted'&&object.identityAgency==='9'&&object.messageIndex===0){
        try{
          const wire=readClosureSourceWire(original.raw_payload,object)
          if(!wire||wire.effectiveTo.marketMinute.slice(8)!=='0000'||!object.objectId)throw new Error('closure_wire_unavailable')
          const assessedAt=new Date().toISOString()
          const point=await findStructuralReviewPoint(input.companyId,object.objectId)
          const receiver=await resolveCanonicalTenantEdielIdentityWithEvidence({companyId:input.companyId,environment:input.environment,asOf:assessedAt,requireExactCounts:true})
          assertInboundTransportMatchesTenantIdentity({identity:receiver.identity,unbReceiverEdielId:wire.transportReceiver})
          if(receiver.identity.legalEdielId!==wire.legalReceiver||!receiver.identity.roleCodes.includes('electricity_supplier')
            ||receiver.evidence.records.transportIdentifiers.some(row=>row.is_verified!==true))throw new Error('closure_party_unavailable')
          const facility=await readSelectedFacilityEvidence({companyId:input.companyId,environment:input.environment,
            meteringPointId:String(point.id),siteId:String(point.site_id),objectId:object.objectId,signal:AbortSignal.timeout(5000)})
          if(facility.gridOwner.ediel_id!==wire.legalSender)throw new Error('closure_sender_unavailable')
          const {source,coverage,legacyEndDateProjection}=await resolveClosureCoverage(seed,wire,readset,point)
          const business:ReviewedClosureBusiness={version:1,owner:'reviewed-received-closure-v1',coverage:'reviewed_post_ledger_closure',
            sourceDisposition:'not_established',businessDisposition:'reviewed',graphNamespace:'legacy_unqualified',
            sourceMessageId:input.sourceMessageId,sourcePayloadHash:seed.evidence.sourcePayloadHash,sourceReceivedAt:original.message_received_at!,
            companyId:input.companyId,environment:input.environment,object,assessedAt,wire,reviewerUserId:input.reviewerUserId,
            reviewStatement:'original_supply_closure',customerId:String(point.customer_id),meteringPointId:String(point.id),siteId:String(point.site_id),
            switchRequestId:coverage.switchRequestId,supplyPeriodId:coverage.supplyPeriodId,coverageWindow:coverage,
            baselineCurrentAssessmentId:source.asOf!.assessmentId,
            baselineCoverageAssessment:{sourceMessageId:source.sourceMessageId,assessmentId:source.asOf!.assessmentId,factsHash:source.asOf!.factsHash,payloadHash:source.payloadHash},
            reviewSnapshot:{snapshotId:readset.timeline.snapshotId!,readsetHash:readset.timeline.readsetHash!,cutoffAt},legacyEndDateProjection}
          if(!isReviewedClosureBusiness(business,original.raw_payload,object))throw new Error('closure_review_marker_invalid')
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
