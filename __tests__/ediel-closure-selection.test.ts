import {expect,it} from 'vitest'
import {selectStructuralSources} from '@/lib/ediel/sources/structuralSourceSelection'
import {closureMarkerFixture} from './helpers/closureOwnerFixtures'
import {structureVersion} from './helpers/structuralComparisonFixtures'
const stop='2026-10-14T23:00:00.000Z'
function query(){
  const {business}=closureMarkerFixture(),baseline=structureVersion()
  baseline.coverage=business.coverageWindow;baseline.payloadHash=business.baselineCoverageAssessment.payloadHash
  const closure={sourceMessageId:business.sourceMessageId,payloadHash:business.sourcePayloadHash,assessmentId:business.reviewerUserId,
    factsHash:'e'.repeat(64),availableAt:'2026-10-02T10:00:00Z',disposition:'accepted' as const,wire:business.wire,marker:business}
  const input={ledgerStartedAt:'2026-09-22T09:00:00Z',cutoffAt:'2026-11-01T00:00:00Z',readComplete:true,unresolvedSources:false,
    versions:[baseline],closures:[closure],closureBlockers:[],objectId:business.object.objectId!,identityAgency:'9',legalSender:'12345',legalReceiver:'54321',
    periodStart:'2026-10-01T00:00:00Z',periodEnd:stop,boundary:'interval' as const}
  return input
}
it('bounds structural coverage exactly while retaining pre-close inventory and provenance',()=>{
  const q=query(),before=structuredClone(q)
  expect(selectStructuralSources(q)).toMatchObject({status:'selected',coverage:{validTo:stop},closure:{sourceMessageId:q.closures[0].sourceMessageId},states:[{meterNumber:'OLD'}]})
  expect(q).toEqual(before)
})
it.each(['interval','current_point'] as const)('stops %s coverage after close',boundary=>{
  const q=query();expect(selectStructuralSources({...q,boundary,periodStart:boundary==='interval'?q.periodStart:stop,periodEnd:boundary==='interval'?'2026-10-15T11:35:00Z':stop}).status).toBe('unavailable')
})
it('permits closing point at exact stop',()=>{
  expect(selectStructuralSources({...query(),periodStart:stop,periodEnd:stop,boundary:'closing_point'})).toMatchObject({status:'selected',states:[{meterNumber:'OLD'}]})
})
it.each(['unavailable','rejected'] as const)('scopes %s closure uncertainty to at/after its boundary',disposition=>{
  const q=query();q.closures=[]
  const blocker={sourceMessageId:'pending',objectId:q.objectId,identityAgency:'9',legalSender:'12345',legalReceiver:'54321',lowerBound:stop,reason:disposition}
  expect(selectStructuralSources({...q,closureBlockers:[blocker]}).status).toBe('unavailable')
  expect(selectStructuralSources({...q,closureBlockers:[blocker],periodEnd:'2026-10-14T22:59:00Z'}).status).toBe('selected')
  expect(selectStructuralSources({...q,closureBlockers:[{...blocker,objectId:'OTHER'}]}).status).toBe('selected')
})
it('missing parties are wildcards and missing dates hold all matching times',()=>{
  const q=query();q.closures=[]
  expect(selectStructuralSources({...q,periodEnd:'2026-10-02T00:00:00Z',closureBlockers:[{sourceMessageId:'missing',objectId:q.objectId,identityAgency:'9',legalSender:null,legalReceiver:null,lowerBound:null,reason:'unknown'}]}).status).toBe('unavailable')
})
it('later/unwitnessed closure is unavailable at the saved cutoff',()=>{
  const q=query();q.closures[0].availableAt='2026-12-01T00:00:00Z'
  expect(selectStructuralSources(q).status).toBe('unavailable')
})
it('two accepted closures do not choose earliest/latest',()=>{
  const q=query(),second=structuredClone(q.closures[0]);second.sourceMessageId='00000000-0000-4000-8000-000000000099';second.marker.sourceMessageId=second.sourceMessageId;q.closures.push(second)
  expect(selectStructuralSources(q).status).toBe('unavailable')
})
it('same-supply closure with a different immutable root cannot bind',()=>{
  const q=query();q.closures[0].marker.coverageWindow={...q.closures[0].marker.coverageWindow,baselineFactsHash:'f'.repeat(64)}
  expect(selectStructuralSources(q).status).toBe('unavailable')
})
it('does not apply another supply closure as an inventory replacement',()=>{
  const q=query();q.closures[0].marker.supplyPeriodId='other'
  expect(selectStructuralSources(q)).toMatchObject({status:'selected',coverage:{validTo:null},states:[{meterNumber:'OLD'}]})
})
