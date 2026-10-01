import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({data:null as unknown,rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
import {readReceivedProdatFinalResponsePlan,receivedProdatFinalResponseQualification} from '@/lib/ediel/core/receivedProdatFinalResponsePlan'
import type {ReceivedProdatResponseValidation} from '@/lib/ediel/core/receivedProdatResponseValidation'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {raw,line} from './fixtures/prodat-register'
import {head,source} from './fixtures/prodat-identity'
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function fixture(){
 const message={...source(raw([...head(),line('1','A',undefined,'9'),['RFF',['LI','OWN-A']],line('2','B',undefined,'9'),['RFF',['LI','OWN-B']]],'Z06'),'Z06'),company_id:uuid(2)}
 // The protected native getter is an explicit IO fixture. This test exercises
 // exact physical binding/opaque capability, not primary-effect authorization.
 const indices=tokenizeEdifact(message.raw_payload!).segments.filter(segment=>segment.tag==='LIN').map(segment=>segment.index)
 const facet:ReceivedProdatResponseValidation={version:1,sourcePayloadHash:evidenceHash(message.raw_payload!),objects:[
  {lineIndex:indices[0],registerLineIndices:[indices[0]],id:'A',li:'OWN-A',outcome:'positive'},
  {lineIndex:indices[1],registerLineIndices:[indices[1]],id:'B',li:'OWN-B',outcome:'held'},
 ],responses:[{scope:'object',lineIndex:indices[0],ercCode:'100',fieldCode:null,text:'OK',id:'A',li:'OWN-A'}]}
 const effect={lineIndex:facet.objects[0].lineIndex,canonicalAssessmentId:uuid(3),objectAssessmentId:uuid(4),appliedAt:'2026-10-01T01:00:00.123456Z'}
 return {message,facet,effect,data:{version:1,sourceMessage:message,responseFacet:{...facet,assessmentId:uuid(3),effectScopes:[effect]}}}
}
beforeEach(()=>{vi.clearAllMocks();io.rpc.mockImplementation(()=>({abortSignal:async()=>({data:io.data,error:null})}))})
describe('protected final response reads actual own structural effects',()=>{
 it('retains exact own physical scope and leaves an uncommitted sibling held',async()=>{
  const f=fixture();io.data=f.data
  const result=await readReceivedProdatFinalResponsePlan({companyId:f.message.company_id,sourceMessageId:f.message.id,rawPayload:f.message.raw_payload!})
  expect(result?.totalObjectCount).toBe(2);expect(result?.plans).toHaveLength(1)
  const plan=result!.plans[0]
  expect(plan).toMatchObject({outcome:'positive',objectLineIndices:[f.effect.lineIndex],acknowledgedReferences:['OWN-A'],objectAssessmentId:uuid(4)})
  expect(receivedProdatFinalResponseQualification({plan,sourceMessage:f.message})).toEqual([f.effect.lineIndex])
  expect(receivedProdatFinalResponseQualification({plan:structuredClone(plan),sourceMessage:f.message})).toBeNull()
  expect(Object.isFrozen(plan.objectLineIndices)).toBe(true)
 })
 it('requires an exact protected effect and cannot borrow a sibling field/reference',async()=>{
  const f=fixture()
  for(const data of [
   {...f.data,responseFacet:{...f.data.responseFacet,effectScopes:[]}},
   {...f.data,responseFacet:{...f.data.responseFacet,effectScopes:[{...f.effect,lineIndex:f.facet.objects[1].lineIndex}]}},
   {...f.data,responseFacet:{...f.data.responseFacet,responses:[{...f.facet.responses[0],li:'OWN-B'}]}},
   {...f.data,responseFacet:{...f.data.responseFacet,responses:[{...f.facet.responses[0],ercCode:'41'}]}},
  ]){
   io.data=data
   expect(await readReceivedProdatFinalResponsePlan({companyId:f.message.company_id,sourceMessageId:f.message.id,rawPayload:f.message.raw_payload!})).toBeNull()
  }
 })
 it('binds exact tenant, source bytes, environment and requested selection',async()=>{
  const f=fixture();io.data=f.data
  const input={companyId:f.message.company_id,sourceMessageId:f.message.id,rawPayload:f.message.raw_payload!}
  expect(await readReceivedProdatFinalResponsePlan({...input,companyId:uuid(99)})).toBeNull()
  expect(await readReceivedProdatFinalResponsePlan({...input,rawPayload:input.rawPayload+' '})).toBeNull()
  expect(await readReceivedProdatFinalResponsePlan({...input,objectLineIndices:[f.facet.objects[1].lineIndex]})).toBeNull()
  const result=await readReceivedProdatFinalResponsePlan(input)
  expect(receivedProdatFinalResponseQualification({plan:result!.plans[0],sourceMessage:{...f.message,environment:'production'}})).toBeNull()
  expect(receivedProdatFinalResponseQualification({plan:result!.plans[0],sourceMessage:{...f.message,raw_payload:input.rawPayload+' '}})).toBeNull()
 })
})
