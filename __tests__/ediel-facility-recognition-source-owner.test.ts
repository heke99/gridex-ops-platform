// Declared operational ports prove delegation and absence of parsed graph writes.
// Native Z02 source/actor/atomic acceptance is proved by its own scoped harness.
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {source as sourceRow} from './fixtures/prodat-identity'
const io=vi.hoisted(()=>({message:null as import('@/lib/ediel/types').EdielMessageRow|null,actor:vi.fn(),apply:vi.fn(),event:vi.fn(),generic:vi.fn()}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>io.message,createEdielMessageEvent:io.event}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/onboarding/inboundEdielLinking',()=>({applyInboundProdatZ02ToCustomerInfoRequest:io.apply}))
vi.mock('@/lib/customer-operations/facilityResponseOrchestrator',()=>({completeFacilityLookupAndRunNextSteps:io.generic}))
import {recognizeInboundFacilityData} from '@/lib/ediel/inbound/inboundFacilityRecognition'
const actor='10000000-0000-4000-8000-000000000002'
beforeEach(()=>{
 vi.clearAllMocks();io.message={...sourceRow("UNB+UNOC:3+A:14+B:14+261001:0000+I++23-DDQ-PRODAT++++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z02+D+9'UNT+3+M'UNZ+1+I'"),direction:'inbound',company_id:'10000000-0000-4000-8000-000000000001',message_standard:'edifact',message_family:'PRODAT',message_code:'Z02',parsed_payload:{facilityId:'UNQUALIFIED-FIRST',meterPointId:'ANOTHER-GUESS'}}
 io.actor.mockResolvedValue(undefined);io.event.mockResolvedValue(undefined);io.apply.mockResolvedValue({applied:true,targetId:'EXACT-REQUEST'})
})
const run=()=>recognizeInboundFacilityData({actorUserId:actor,edielMessageId:io.message!.id})
describe('facility recognition consumes the same protected Z02 owner',()=>{
 it('delegates the exact original and actor without a parsed facility write',async()=>{
  expect(await run()).toMatchObject({status:'completed',requestId:'EXACT-REQUEST',facilityId:null,meteringPointId:null})
  expect(io.apply).toHaveBeenCalledWith({actorUserId:actor,message:io.message});expect(io.generic).not.toHaveBeenCalled()
 })
 it('keeps a native source hold and does not fall back to generic completion',async()=>{
  io.apply.mockResolvedValue({applied:false,targetId:'EXACT-REQUEST',reason:'source_witness_required'})
  expect(await run()).toMatchObject({status:'manual_review',reason:'source_witness_required'})
  expect(io.generic).not.toHaveBeenCalled()
 })
 it.each(['Z04','Z06','Z10','Z14'])('does not turn %s parsed metadata into a facility lookup response',async code=>{
  io.message={...io.message!,message_code:code}
  expect(await run()).toMatchObject({status:'manual_review',reason:'source_qualified_z02_required'})
  expect(io.apply).not.toHaveBeenCalled();expect(io.generic).not.toHaveBeenCalled()
 })
 it('requires actual physical Z02, not a row label',async()=>{
  io.message={...io.message!,raw_payload:io.message!.raw_payload!.replace('BGM+Z02','BGM+Z06')}
  expect(await run()).toMatchObject({status:'manual_review'});expect(io.apply).not.toHaveBeenCalled()
 })
 it('denies the current tenant actor before source operation or metadata writes',async()=>{
  io.actor.mockRejectedValue(Error('denied'))
  await expect(run()).rejects.toThrow('denied');expect(io.apply).not.toHaveBeenCalled();expect(io.event).not.toHaveBeenCalled()
 })
})
