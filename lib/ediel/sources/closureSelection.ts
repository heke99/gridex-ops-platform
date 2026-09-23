import {isDeepStrictEqual} from 'node:util'
import {parseSourceReceiptInstant as instant} from '@/lib/ediel/utilts/receivedSourceInventory'
import type {ClosureSourceWire} from './closureSourceWire'
import type {ReviewedClosureBusiness} from './reviewedClosureSource'
import type {StructuralCoverage,StructuralSelectionInput,StructuralVersion} from './structuralSourceSelection'

export type ClosureVersion={sourceMessageId:string;payloadHash:string;assessmentId:string|null;factsHash:string|null;availableAt:string|null;
  disposition:'accepted'|'rejected'|'unavailable';wire:ClosureSourceWire;marker:ReviewedClosureBusiness}
export type ScopedClosureBlocker={sourceMessageId:string;objectId:string;identityAgency:string|null;legalSender:string|null;legalReceiver:string|null;lowerBound:string|null;reason:string}
export type ClosureProvenance={sourceMessageId:string;payloadHash:string;assessmentId:string;factsHash:string;effectiveTo:string;
  baselineCoverageAssessment:ReviewedClosureBusiness['baselineCoverageAssessment']}
export function closureBlockerMatches(blocker:ScopedClosureBlocker,input:StructuralSelectionInput){
  return blocker.objectId===input.objectId&&(blocker.identityAgency===null||blocker.identityAgency===input.identityAgency)
    &&(blocker.legalSender===null||blocker.legalSender===input.legalSender)&&(blocker.legalReceiver===null||blocker.legalReceiver===input.legalReceiver)
    &&(instant(blocker.lowerBound)===null||instant(input.periodEnd)!>=instant(blocker.lowerBound)!)
}
/** Supply coverage only: closures never enter the inventory/replacement graph. */
export function boundCoverageByClosures(input:StructuralSelectionInput,baseline:StructuralVersion):
  {coverage:StructuralCoverage;closure?:ClosureProvenance}|{reason:string}{
  const coverage=structuredClone(baseline.coverage!),end=instant(input.periodEnd)!,cutoff=instant(input.cutoffAt)!
  const matching=(input.closures??[]).filter(({wire,marker})=>wire.object.objectId===input.objectId&&wire.object.identityAgency===input.identityAgency
    &&wire.legalSender===input.legalSender&&wire.legalReceiver===input.legalReceiver&&marker.supplyPeriodId===coverage.supplyPeriodId)
  const affected=(version:ClosureVersion)=>instant(version.wire.effectiveTo.utc)===null||end>=instant(version.wire.effectiveTo.utc)!
  const valid=(version:ClosureVersion)=>version.disposition==='accepted'&&version.assessmentId!==null&&version.factsHash!==null
    &&instant(version.availableAt)!==null&&instant(version.availableAt)!<=cutoff
    &&version.sourceMessageId===version.marker.sourceMessageId&&version.payloadHash===version.marker.sourcePayloadHash
    &&isDeepStrictEqual(version.wire,version.marker.wire)&&isDeepStrictEqual(version.marker.coverageWindow,coverage)
    &&version.marker.baselineCoverageAssessment.sourceMessageId===coverage.baselineSourceMessageId
    &&version.marker.baselineCoverageAssessment.payloadHash===baseline.payloadHash
    &&instant(version.wire.effectiveTo.utc)!>instant(coverage.validFrom)!
    &&(coverage.validTo===null||instant(coverage.validTo)===instant(version.wire.effectiveTo.utc))
  if(matching.some(version=>!valid(version)&&affected(version)))return {reason:'structural_closure_unconfirmed'}
  if(matching.length>1)return matching.some(affected)?{reason:'structural_closure_conflict'}:{coverage}
  const version=matching[0]
  if(!version||!valid(version))return {coverage}
  coverage.validTo=version.wire.effectiveTo.utc
  return {coverage,closure:{sourceMessageId:version.sourceMessageId,payloadHash:version.payloadHash,assessmentId:version.assessmentId!,factsHash:version.factsHash!,
    effectiveTo:version.wire.effectiveTo.utc,baselineCoverageAssessment:structuredClone(version.marker.baselineCoverageAssessment)}}
}
