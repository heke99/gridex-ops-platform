import {expect,it} from 'vitest'
import {projectCorrectionContextBlocker, type BoundaryObservation, type CorrectionScopeV1} from '@/lib/ediel/sources/correctionContextImpact'
import {selectStructuralSources} from '@/lib/ediel/sources/structuralSourceSelection'
import {closureMarkerFixture} from './helpers/closureOwnerFixtures'
import {structureVersion} from './helpers/structuralComparisonFixtures'

const at=(day:number)=>day===40?'2026-11-09T00:00:00Z':`2026-10-${String(day).padStart(2,'0')}T00:00:00Z`
const known=(day:number):BoundaryObservation=>({kind:'known',utc:at(day)})
const scope:CorrectionScopeV1={companyId:'company-a',environment:'test',customerId:'customer-a',objectId:closureMarkerFixture().business.object.objectId,identityAgency:'9',legalSender:'12345',legalReceiver:'54321',supplyPeriodId:'supply-a'}
function query(){
  const {business}=closureMarkerFixture(),baseline=structureVersion()
  baseline.coverage={...business.coverageWindow,supplyPeriodId:'supply-a'}
  baseline.payloadHash=business.baselineCoverageAssessment.payloadHash
  return {ledgerStartedAt:'2026-09-22T09:00:00Z',cutoffAt:at(10),readComplete:true,unresolvedSources:false,
    versions:[baseline],closures:[],closureBlockers:[],companyId:'company-a',environment:'test' as const,customerId:'customer-a',supplyPeriodId:'supply-a',
    objectId:business.object.objectId!,identityAgency:'9',legalSender:'12345',legalReceiver:'54321',
    periodStart:at(2),periodEnd:at(25),boundary:'interval' as const}
}
function blocker(oldStop:BoundaryObservation,proposedStop:BoundaryObservation,changes:Partial<CorrectionScopeV1>={}){
  return projectCorrectionContextBlocker({rawC:null,oldStop,proposedStop,observedAt:at(10),sourceId:'correction-1',scope:{...scope,...changes}})
}
it('holds from the earliest old/proposed boundary at its observed cutoff, without rewriting coverage',()=>{
  const b=blocker(known(30),known(20)),q=query()
  expect(b).toMatchObject({version:1,lowerBoundUtc:at(20),oldStop:known(30),proposedStop:known(20)})
  expect(selectStructuralSources({...q,correctionContextBlockers:[b]})).toEqual({status:'unavailable',reason:'structural_correction_context_hold'})
  for(const boundary of ['current_point','closing_point'] as const)
    expect(selectStructuralSources({...q,boundary,periodStart:at(20),periodEnd:at(20),correctionContextBlockers:[b]})).toEqual({status:'unavailable',reason:'structural_correction_context_hold'})
  expect(selectStructuralSources({...q,cutoffAt:at(9),correctionContextBlockers:[b]}).status).toBe('selected')
  expect(selectStructuralSources({...q,periodEnd:at(19),correctionContextBlockers:[b]}).status).toBe('selected')
  expect(selectStructuralSources({...q,objectId:'OTHER',correctionContextBlockers:[b]})).not.toEqual({status:'unavailable',reason:'structural_correction_context_hold'})
  expect(selectStructuralSources({...q,periodStart:at(2),periodEnd:at(25)}).status).toBe('selected')
})
it('unknown potentially earlier boundary holds the entire matching supply interval',()=>{
  const b=blocker(known(30),{kind:'unknown'}),q=query()
  expect(b.lowerBoundUtc).toBeNull()
  expect(selectStructuralSources({...q,periodEnd:at(9),correctionContextBlockers:[b]})).toEqual({status:'unavailable',reason:'structural_correction_context_hold'})
  expect(blocker({kind:'unknown'},known(40)).lowerBoundUtc).toBeNull()
  expect(blocker(known(30),{kind:'not_asserted'}).lowerBoundUtc).toBe(at(30))
  expect(blocker({kind:'not_asserted'},known(20)).lowerBoundUtc).toBe(at(20))
  expect(blocker(known(30),known(40)).lowerBoundUtc).toBe(at(30))
  const later=blocker(known(30),known(40))
  expect(selectStructuralSources({...q,periodEnd:at(29),correctionContextBlockers:[later]}).status).toBe('selected')
  expect(selectStructuralSources({...q,periodEnd:at(30),correctionContextBlockers:[later]})).toEqual({status:'unavailable',reason:'structural_correction_context_hold'})
})
it('missing scope is wildcard, while concrete tenant and supply mismatches are unrelated',()=>{
  const q=query(),b=blocker(known(30),known(20),{legalSender:null,customerId:null,supplyPeriodId:null})
  expect(selectStructuralSources({...q,correctionContextBlockers:[b]})).toEqual({status:'unavailable',reason:'structural_correction_context_hold'})
  expect(selectStructuralSources({...q,companyId:undefined,correctionContextBlockers:[b]})).toEqual({status:'unavailable',reason:'structural_correction_context_hold'})
  for(const changes of [{companyId:'company-b'},{environment:'production' as const},{customerId:'customer-b'},{supplyPeriodId:'supply-b'}]){
    const scoped=blocker(known(30),known(20),changes)
    expect(selectStructuralSources({...q,correctionContextBlockers:[scoped]}).status).toBe('selected')
  }
})
it('projects only hold hints and refuses invalid instants or empty/invalid scope',()=>{
  const b=projectCorrectionContextBlocker({rawC:"BGM+Z05+REF+5'",oldStop:known(30),proposedStop:known(20),observedAt:at(10),sourceId:'raw-c',scope})
  expect(b).not.toHaveProperty('wire')
  expect(b).not.toHaveProperty('coverage')
  expect(b).not.toHaveProperty('disposition')
  expect(b.lowerBoundUtc).toBe(at(20))
  // A bare C can positively omit a changed end; an artifact referring to an
  // unspecified changed end must instead be passed as unknown.
  expect(projectCorrectionContextBlocker({rawC:"BGM+Z05+REF+5'",oldStop:known(30),proposedStop:{kind:'not_asserted'},observedAt:at(10),sourceId:'bare-c',scope}).lowerBoundUtc).toBe(at(30))
  expect(projectCorrectionContextBlocker({rawC:null,oldStop:known(30),proposedStop:{kind:'unknown'},observedAt:at(10),sourceId:'unwitnessed-artifact',scope}).lowerBoundUtc).toBeNull()
  expect(()=>blocker({kind:'known',utc:'2026-10-32T00:00:00Z'},known(20))).toThrow()
  expect(()=>projectCorrectionContextBlocker({rawC:null,oldStop:known(30),proposedStop:known(20),observedAt:'invalid',sourceId:'x',scope})).toThrow()
  expect(()=>blocker(known(30),known(20),{companyId:''})).toThrow()
  expect(()=>blocker(known(30),known(20),{objectId:' '})).toThrow()
})
