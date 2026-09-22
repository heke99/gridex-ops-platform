import {isDeepStrictEqual} from 'node:util'
import {isEvidenceRecord, isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {readStructuralSourceWire, type StructuralSourceWire} from './structuralSourceWire'
import type {SourceObjectScope} from './sourceOwnerWire'
import type {StructuralCoverage, StructuralReplacement} from './structuralSourceSelection'

export type ReviewedStructuralBusiness = {
  version:1; owner:'reviewed-received-structure-v1'; coverage:'reviewed_post_ledger_supply'
  sourceDisposition:'not_established'; businessDisposition:'reviewed'; graphNamespace:'legacy_unqualified'
  sourceMessageId:string; sourcePayloadHash:string; sourceReceivedAt:string; companyId:string; environment:'test'|'production'
  object:SourceObjectScope; assessedAt:string; wire:StructuralSourceWire
  reviewerUserId:string; reviewStatement:'original_structural_message'
  customerId:string; meteringPointId:string; siteId:string; switchRequestId:string; supplyPeriodId:string
  coverageWindow:StructuralCoverage; baselineCurrentAssessmentId:string
  reviewSnapshot:{snapshotId:string;readsetHash:string;cutoffAt:string}
  replaces:StructuralReplacement|null
}
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const time=(value:unknown):value is string=>typeof value==='string'&&parseSourceReceiptInstant(value)!==null
const closed=(value:unknown,fields:string[]):value is Record<string,unknown>=>isEvidenceRecord(value)
  &&Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field))

/** A serialized marker checker, NOT an authority/capability constructor. The
 * trusted service read and SQL owner revalidation supply that boundary. */
export function isReviewedStructuralBusiness(value:unknown,raw:string,object:SourceObjectScope):value is ReviewedStructuralBusiness {
  if(!closed(value,['version','owner','coverage','sourceDisposition','businessDisposition','graphNamespace',
    'sourceMessageId','sourcePayloadHash','sourceReceivedAt','companyId','environment','object','assessedAt','wire',
    'reviewerUserId','reviewStatement','customerId','meteringPointId','siteId','switchRequestId','supplyPeriodId',
    'coverageWindow','baselineCurrentAssessmentId','reviewSnapshot','replaces'])
    ||value.version!==1||value.owner!=='reviewed-received-structure-v1'||value.coverage!=='reviewed_post_ledger_supply'
    ||value.sourceDisposition!=='not_established'||value.businessDisposition!=='reviewed'||value.graphNamespace!=='legacy_unqualified'
    ||value.reviewStatement!=='original_structural_message'||!['test','production'].includes(String(value.environment))
    ||![value.sourceMessageId,value.companyId,value.reviewerUserId,value.customerId,value.meteringPointId,value.siteId,
      value.switchRequestId,value.supplyPeriodId,value.baselineCurrentAssessmentId].every(isEvidenceUuid)
    ||!hash(value.sourcePayloadHash)||!time(value.sourceReceivedAt)||!time(value.assessedAt)
    ||object.identityAgency!=='9'||!isDeepStrictEqual(value.object,object))return false
  const wire=readStructuralSourceWire(raw,object)
  if(!wire||!isDeepStrictEqual(value.wire,wire))return false
  const coverage=value.coverageWindow,snapshot=value.reviewSnapshot,replaces=value.replaces
  if(!closed(coverage,['kind','baselineSourceMessageId','baselineAssessmentId','baselineFactsHash','supplyPeriodId',
    'switchRequestId','switchCreatedAt','outboundSourceMessageId','outboundCreatedAt','validFrom','validTo'])
    ||coverage.kind!=='post_ledger_supply'||coverage.supplyPeriodId!==value.supplyPeriodId||coverage.switchRequestId!==value.switchRequestId
    ||![coverage.baselineSourceMessageId,coverage.baselineAssessmentId,coverage.outboundSourceMessageId].every(isEvidenceUuid)
    ||!hash(coverage.baselineFactsHash)||![coverage.switchCreatedAt,coverage.outboundCreatedAt,coverage.validFrom].every(time)
    ||coverage.validTo!==null&&!time(coverage.validTo)
    ||!closed(snapshot,['snapshotId','readsetHash','cutoffAt'])||!isEvidenceUuid(snapshot.snapshotId)
    ||!hash(snapshot.readsetHash)||!time(snapshot.cutoffAt))return false
  if(replaces!==null&&(!closed(replaces,['sourceMessageId','assessmentId','payloadHash'])
    ||!isEvidenceUuid(replaces.sourceMessageId)||!isEvidenceUuid(replaces.assessmentId)||!hash(replaces.payloadHash)))return false
  return wire.functionCode==='5'?replaces!==null:replaces===null
}
