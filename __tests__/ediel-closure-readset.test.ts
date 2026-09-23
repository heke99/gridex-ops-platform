import {expect,it} from 'vitest'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {closureFixture} from './helpers/closureWireFixtures'
import {timelineScope,timelineSource,timelineBody,timelineReceipt,timelineAssessment,timelineFacts} from './helpers/sourceDecisionTimelineFixtures'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
function inspect(raw:string,rejected=false){
  const facts=timelineFacts(rejected?raw:closureFixture().wire)
  if(rejected)for(const object of facts.objects){object.disposition='rejected';object.reasons=['canonical_rejected']}
  const factsText=JSON.stringify(facts)
  return inspectStructuralReadset(timelineScope,timelineReceipt(timelineBody([timelineSource({messageCode:'Z05',rawPayload:raw,payloadHash:evidenceHash(raw),
    assessments:rejected?[timelineAssessment(101,null,{factsText,factsHash:evidenceHash(factsText)})]:[]})])))
}
it.each([false,true])('keeps every unreviewed/rejected closure scoped, rejected=%s',rejected=>{
  const result=inspect(closureFixture({count:2}).wire,rejected)
  expect(result.timeline.status).toBe('inspected');expect(result.unresolvedSources).toBe(false)
  expect(result.versions).toEqual([]);expect(result.closures).toEqual([])
  expect(result.closureBlockers).toHaveLength(2)
  expect(result.closureBlockers[0]).toMatchObject({objectId:'735123456789012345',identityAgency:'9',lowerBound:'2026-10-15T11:34:00.000Z',legalSender:'12345',legalReceiver:'54321'})
})
it('unknown date and party cannot exclude the same physical object',()=>{
  const {wire}=closureFixture()
  const result=inspect(wire.replace('DTM+93:','DTM+92:').replace('NAD+FR+','NAD+XX+'))
  expect(result.unresolvedSources).toBe(false)
  expect(result.closureBlockers).toMatchObject([{objectId:'735123456789012345',lowerBound:null,legalSender:null}])
})
it('C is visible and BGM5 cannot revive dates before its proposed later stop',()=>{
  const {wire}=closureFixture()
  expect(inspect(wire.replace('CAV+Z22','CAV+Z24')).closureBlockers).toMatchObject([{reason:'closure_unsupported',lowerBound:'2026-10-15T11:34:00.000Z'}])
  expect(inspect(wire.replace('CLOSE-DOC+9+','CLOSE-DOC+5+')).closureBlockers).toMatchObject([{lowerBound:null}])
})
it('unbounded malformed/unknown object stays a global hold',()=>{
  const {wire}=closureFixture()
  expect(inspect(wire.replace('735123456789012345:::9',':::9')).unresolvedSources).toBe(true)
  expect(inspect(wire+'?').unresolvedSources).toBe(true)
})
