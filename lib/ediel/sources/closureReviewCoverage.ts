import {isDeepStrictEqual} from 'node:util'
import {parseSourceReceiptInstant as instant} from '@/lib/ediel/utilts/receivedSourceInventory'
import type {SourceOwnerSeed,SourceObjectDecision} from './sourceOwnerPersistence'
import type {ClosureSourceWire} from './closureSourceWire'
import type {StructuralReadset} from './structuralSourceReadset'
import {isReviewedStructuralBusiness} from './reviewedStructuralSource'
import {readStructuralReviewRow} from './structuralReviewReads'

/** Resolve only the latest witnessed reviewed Z04 coverage. Ended mutable rows
 * corroborate its unchanged identities; they cannot reconstruct missing proof. */
export async function resolveClosureCoverage(seed:SourceOwnerSeed,wire:ClosureSourceWire,readset:StructuralReadset,point:Record<string,unknown>){
 const candidates=[]
 const epoch=instant(readset.timeline.ledgerStartedAt),cutoff=instant(readset.timeline.cutoffAt),stop=instant(wire.effectiveTo.utc)!
 if(epoch===null||cutoff===null)throw Error('closure_ledger_unknown')
 const day=`${wire.effectiveTo.marketMinute.slice(0,4)}-${wire.effectiveTo.marketMinute.slice(4,6)}-${wire.effectiveTo.marketMinute.slice(6,8)}`
 for(const source of readset.sources){
  if(!source.asOf)continue
  for(const entry of source.objects){
   if(entry.disposition!=='accepted'||entry.object.objectId!==wire.object.objectId||entry.object.identityAgency!==wire.object.identityAgency
    ||!isReviewedStructuralBusiness(entry.business,source.rawPayload,entry.object))continue
   const prior=entry.business,coverage=prior.coverageWindow
   if(prior.companyId!==seed.evidence.companyId||prior.environment!==seed.evidence.environment||prior.sourceMessageId!==source.sourceMessageId
    ||prior.sourcePayloadHash!==source.payloadHash||prior.wire.messageCode!=='Z04'||prior.wire.functionCode==='5'||prior.replaces!==null
    ||prior.wire.legalSender!==wire.legalSender||prior.wire.legalReceiver!==wire.legalReceiver
    ||coverage.baselineSourceMessageId!==source.sourceMessageId||prior.meteringPointId!==point.id||prior.siteId!==point.site_id
    ||prior.customerId!==point.customer_id||instant(coverage.validFrom)!>=stop||instant(coverage.validFrom)!<epoch
    ||coverage.validTo!==null&&instant(coverage.validTo)!==stop)continue
   const revision=readset.timeline.sources.find(item=>item.sourceMessageId===source.sourceMessageId)?.revisions.find(item=>
    item.assessmentId===coverage.baselineAssessmentId&&item.factsHash===coverage.baselineFactsHash&&item.availability==='witnessed_by_cutoff')
   const root=source.assessments.find(item=>item.id===coverage.baselineAssessmentId&&item.factsHash===coverage.baselineFactsHash)
   if(!revision||!root)continue
   const roots=(JSON.parse(root.factsText) as {objects:SourceObjectDecision[]}).objects.filter(item=>
    item.object.objectId===wire.object.objectId&&item.object.identityAgency===wire.object.identityAgency)
   if(roots.length!==1||roots[0].disposition!=='accepted')continue
   const committed=roots[0].business
   if(!committed||committed.owner!=='inbound-z04-switch-confirmation-v1'||committed.sourceMessageId!==source.sourceMessageId
    ||committed.sourcePayloadHash!==source.payloadHash||committed.companyId!==seed.evidence.companyId||committed.environment!==seed.evidence.environment
    ||['customerId','meteringPointId','siteId','switchRequestId','supplyPeriodId'].some(key=>committed[key]!==prior[key as keyof typeof prior])
    ||!isDeepStrictEqual(committed.effectiveFrom,{
      fieldNumber:'210',marketMinute:prior.wire.effectiveFrom.marketMinute,utc:coverage.validFrom,committedDatePrecision:'market_calendar_day'}))continue
   const sw=await readStructuralReviewRow('supplier_switch_requests',seed.evidence.companyId,prior.switchRequestId)
   const sp=await readStructuralReviewRow('customer_supply_periods',seed.evidence.companyId,prior.supplyPeriodId)
   if(sw.inbound_z04_message_id!==source.sourceMessageId||sw.status!=='accepted'||sw.rff_li_reference!==prior.wire.caseReference
    ||sp.source_message_id!==seed.evidence.sourceMessageId||sp.status!=='ended'||sp.end_date!==day
    ||sw.customer_id!==point.customer_id||sp.customer_id!==point.customer_id||sw.metering_point_id!==point.id||sp.metering_point_id!==point.id
    ||sw.site_id!==point.site_id||sp.source_switch_request_id!==null&&sp.source_switch_request_id!==sw.id
    ||sw.confirmed_start_date!==sp.start_date||typeof sp.start_date!=='string'
    ||instant(`${sp.start_date}T00:00:00+01:00`)!==instant(coverage.validFrom)
    ||instant(sw.created_at)!==instant(coverage.switchCreatedAt)||instant(sw.created_at)!<epoch||instant(sw.created_at)!>instant(coverage.validFrom)!
    ||sw.outbound_z03_message_id!==coverage.outboundSourceMessageId)continue
   const outbound=await readStructuralReviewRow('ediel_messages',seed.evidence.companyId,coverage.outboundSourceMessageId)
   const created=instant(outbound.created_at),sent=instant(outbound.message_sent_at)
   if(outbound.environment!==seed.evidence.environment||outbound.direction!=='outbound'||outbound.message_standard!=='edifact'
    ||outbound.message_family!=='PRODAT'||outbound.message_code!=='Z03'||outbound.customer_id!==point.customer_id
    ||outbound.metering_point_id!==point.id||outbound.site_id!==point.site_id||created===null||sent===null
    ||created!==instant(coverage.outboundCreatedAt)||created<instant(coverage.switchCreatedAt)!||created>cutoff
    ||sent<created||sent>instant(prior.sourceReceivedAt)!)continue
   candidates.push({source,coverage:structuredClone(coverage),legacyEndDateProjection:day})
  }
 }
 if(candidates.length!==1)throw Error('closure_baseline_ambiguous')
 return candidates[0]
}
