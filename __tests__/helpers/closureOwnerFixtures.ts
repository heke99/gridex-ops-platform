import {closureFixture} from './closureWireFixtures'
import {ownerId,OWNER} from './sourceOwnerFixtures'
import {readClosureSourceWire} from '@/lib/ediel/sources/closureSourceWire'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'

// Serialized proof shape only: it cannot be used as a native owner. Native
// tests must produce the committed root, reviewed baseline and closure afresh.
export function closureMarkerFixture(){
  const {wire:raw,scope}=closureFixture()
  const business={version:1,owner:'reviewed-received-closure-v1',coverage:'reviewed_post_ledger_closure',
    sourceDisposition:'not_established',businessDisposition:'reviewed',graphNamespace:'legacy_unqualified',
    sourceMessageId:ownerId(30),sourcePayloadHash:evidenceHash(raw),sourceReceivedAt:'2026-09-23T10:00:00Z',
    companyId:OWNER.company,environment:'test',object:scope,assessedAt:'2026-09-23T10:01:00Z',wire:readClosureSourceWire(raw,scope)!,
    reviewerUserId:ownerId(31),reviewStatement:'original_supply_closure',customerId:OWNER.customer,meteringPointId:OWNER.point,
    siteId:OWNER.site,switchRequestId:OWNER.switch,supplyPeriodId:OWNER.supply,
    coverageWindow:{kind:'post_ledger_supply',baselineSourceMessageId:OWNER.source,baselineAssessmentId:ownerId(32),baselineFactsHash:'a'.repeat(64),
      supplyPeriodId:OWNER.supply,switchRequestId:OWNER.switch,switchCreatedAt:'2026-09-23T09:00:00Z',outboundSourceMessageId:ownerId(33),
      outboundCreatedAt:'2026-09-23T09:01:00Z',validFrom:'2026-09-30T23:00:00.000Z',validTo:null},
    baselineCoverageAssessment:{sourceMessageId:OWNER.source,assessmentId:ownerId(34),factsHash:'b'.repeat(64),payloadHash:'c'.repeat(64)},
    baselineCurrentAssessmentId:ownerId(34),reviewSnapshot:{snapshotId:ownerId(35),readsetHash:'d'.repeat(64),cutoffAt:'2026-09-23T10:00:30Z'},
    legacyEndDateProjection:'2026-10-15'}
  return {raw,scope,business}
}
