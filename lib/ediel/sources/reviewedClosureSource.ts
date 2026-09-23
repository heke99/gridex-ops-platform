import {isDeepStrictEqual} from 'node:util'
import {isEvidenceRecord,isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {readClosureSourceWire,type ClosureSourceWire} from './closureSourceWire'
import type {SourceObjectScope} from './sourceOwnerWire'
import type {StructuralCoverage} from './structuralSourceSelection'

export type ReviewedClosureBusiness={
  version:1;owner:'reviewed-received-closure-v1';coverage:'reviewed_post_ledger_closure'
  sourceDisposition:'not_established';businessDisposition:'reviewed';graphNamespace:'legacy_unqualified'
  sourceMessageId:string;sourcePayloadHash:string;sourceReceivedAt:string;companyId:string;environment:'test'|'production'
  object:SourceObjectScope;assessedAt:string;wire:ClosureSourceWire;reviewerUserId:string;reviewStatement:'original_supply_closure'
  customerId:string;meteringPointId:string;siteId:string;switchRequestId:string;supplyPeriodId:string
  coverageWindow:StructuralCoverage;baselineCurrentAssessmentId:string
  baselineCoverageAssessment:{sourceMessageId:string;assessmentId:string;factsHash:string;payloadHash:string}
  reviewSnapshot:{snapshotId:string;readsetHash:string;cutoffAt:string}
  /** Calendar corroboration only. Exact precision belongs to structural supply
   * coverage; this does not upgrade downstream billing/lifecycle DATE columns. */
  legacyEndDateProjection:string
}
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const instant=parseSourceReceiptInstant
const time=(v:unknown):v is string=>typeof v==='string'&&instant(v)!==null
const closed=(v:unknown,fields:string[]):v is Record<string,unknown>=>isEvidenceRecord(v)
  &&Object.keys(v).length===fields.length&&fields.every(field=>Object.hasOwn(v,field))

/** Closed serialization check, never an authority constructor. Immutable
 * root/coverage resolution and append-time live SQL proofs remain mandatory. */
export function isReviewedClosureBusiness(value:unknown,raw:string,object:SourceObjectScope):value is ReviewedClosureBusiness{
  if(!closed(value,['version','owner','coverage','sourceDisposition','businessDisposition','graphNamespace',
    'sourceMessageId','sourcePayloadHash','sourceReceivedAt','companyId','environment','object','assessedAt','wire',
    'reviewerUserId','reviewStatement','customerId','meteringPointId','siteId','switchRequestId','supplyPeriodId',
    'coverageWindow','baselineCurrentAssessmentId','baselineCoverageAssessment','reviewSnapshot','legacyEndDateProjection'])
    ||value.version!==1||value.owner!=='reviewed-received-closure-v1'||value.coverage!=='reviewed_post_ledger_closure'
    ||value.sourceDisposition!=='not_established'||value.businessDisposition!=='reviewed'||value.graphNamespace!=='legacy_unqualified'
    ||value.reviewStatement!=='original_supply_closure'||!['test','production'].includes(String(value.environment))
    ||![value.sourceMessageId,value.companyId,value.reviewerUserId,value.customerId,value.meteringPointId,value.siteId,
      value.switchRequestId,value.supplyPeriodId,value.baselineCurrentAssessmentId].every(isEvidenceUuid)
    ||!hash(value.sourcePayloadHash)||!time(value.sourceReceivedAt)||!time(value.assessedAt)
    ||object.identityAgency!=='9'||!isDeepStrictEqual(value.object,object))return false
  const wire=readClosureSourceWire(raw,object)
  if(!wire||!isDeepStrictEqual(value.wire,wire))return false
  const cover=value.coverageWindow,baseline=value.baselineCoverageAssessment,snapshot=value.reviewSnapshot
  if(!closed(cover,['kind','baselineSourceMessageId','baselineAssessmentId','baselineFactsHash','supplyPeriodId',
    'switchRequestId','switchCreatedAt','outboundSourceMessageId','outboundCreatedAt','validFrom','validTo'])
    ||cover.kind!=='post_ledger_supply'||cover.supplyPeriodId!==value.supplyPeriodId||cover.switchRequestId!==value.switchRequestId
    ||![cover.baselineSourceMessageId,cover.baselineAssessmentId,cover.outboundSourceMessageId].every(isEvidenceUuid)
    ||!hash(cover.baselineFactsHash)||![cover.switchCreatedAt,cover.outboundCreatedAt,cover.validFrom].every(time)
    ||cover.validTo!==null&&!time(cover.validTo)
    ||!closed(baseline,['sourceMessageId','assessmentId','factsHash','payloadHash'])
    ||baseline.sourceMessageId!==cover.baselineSourceMessageId||baseline.sourceMessageId===value.sourceMessageId
    ||baseline.assessmentId!==value.baselineCurrentAssessmentId||!hash(baseline.factsHash)||!hash(baseline.payloadHash)
    ||!closed(snapshot,['snapshotId','readsetHash','cutoffAt'])||!isEvidenceUuid(snapshot.snapshotId)
    ||!hash(snapshot.readsetHash)||!time(snapshot.cutoffAt))return false
  const minute=wire.effectiveTo.marketMinute,stop=instant(wire.effectiveTo.utc)!
  return instant(cover.validFrom)!<stop&&(cover.validTo===null||instant(cover.validTo)===stop)
    &&value.legacyEndDateProjection===`${minute.slice(0,4)}-${minute.slice(4,6)}-${minute.slice(6,8)}`
    &&instant(value.sourceReceivedAt)!<=instant(value.assessedAt)!
    &&instant(snapshot.cutoffAt)!<=instant(value.assessedAt)!
}
