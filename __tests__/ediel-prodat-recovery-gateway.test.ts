import { beforeEach,describe,expect,it,vi } from 'vitest'
import { finalizeRecoveryDraft,queueRecoveryDraft } from '@/lib/ediel/intent/prodatRecoveryGateway'
import { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'
import { source } from './fixtures/prodat-identity'
const io=vi.hoisted(()=>({rpc:vi.fn(),finalize:vi.fn(),route:vi.fn(),intent:vi.fn(),validate:vi.fn(),lifecycle:vi.fn(),queue:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/core/kernel',()=>({finalizeCanonicalOutboundDraft:io.finalize,resolveCanonicalOutboundContext:io.route}))
vi.mock('@/lib/ediel/intent/intentEngine',()=>({getEdielMessageIntentById:io.intent,evaluateIntentValidation:io.validate,updateIntentLifecycle:io.lifecycle}))
vi.mock('@/lib/ediel/flows/shared',()=>({queuePreparedEdielMessage:io.queue}))
const intent:EdielMessageIntent={id:'new-intent',companyId:'tenant',environment:'test',market:'electricity',messageFamily:'PRODAT',messageCode:'Z01',businessProcess:'customer_masterdata',direction:'outbound',senderEdielId:'111',receiverEdielId:'222',applicationReference:'23-DDQ-PRODAT',routeProfileId:'profile',communicationRouteId:'route',customerId:'customer',operationId:'operation',interchangeReference:'NEW',messageReference:'1',payload:{},idempotencyKey:'recovery:operation',validationStatus:'validated',renderStatus:'not_rendered',outboxStatus:'not_queued'}
const message={...source('wire'),id:'new-message',company_id:'tenant',message_code:'Z01',intent_id:'new-intent',source_operation_id:'operation',outbound_request_id:'chosen-request',original_message_id:'original',direction:'outbound' as const,status:'draft' as const}
const scope={companyId:'tenant',operationId:'operation',actorUserId:'actor'}
beforeEach(()=>{vi.resetAllMocks();io.intent.mockResolvedValue(intent);io.validate.mockReturnValue({ok:true});io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_reserve_prodat_recovery_origin_v1'?{status:'reserved',intentId:'new-intent',outboundRequestId:'chosen-request',messageId:'new-message'}:null,error:null}));io.queue.mockResolvedValue(undefined);io.lifecycle.mockResolvedValue(undefined);io.finalize.mockResolvedValue(message);io.route.mockResolvedValue({route:{id:'route'}})})
describe('correction intent/private origin gateway',()=>{
 it('uses the first private chosen request and exact new intent identity in shared finalization',async()=>{
  const routeContext=await resolveCanonicalOutboundContext({companyId:'tenant',environment:'test',requestType:'customer_masterdata'})
  const draft:CreateEdielMessageInput={actorUserId:scope.actorUserId,companyId:scope.companyId,direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z01',rawPayload:'wire'}
  const result=await finalizeRecoveryDraft({...scope,intent,params:{actorUserId:'actor',requestType:'customer_masterdata',routeContext,outboundRequestId:'racing-request',draft,duplicateCheck:{messageFamily:'PRODAT',messageCode:'Z01'}}})
  expect(result.id).toBe('new-message');expect(io.finalize.mock.calls[0][0]).toMatchObject({outboundRequestId:'chosen-request',draft:{actorUserId:scope.actorUserId,messageStandard:'edifact',intentId:'new-intent',outboundRequestId:'chosen-request'},duplicateCheck:{sourceId:'new-intent'}})
 })
 it('never queues a foreign dedupe/private binding',async()=>{
  io.rpc.mockResolvedValue({data:{status:'reserved',intentId:'new-intent',outboundRequestId:'chosen-request',messageId:'old-other-message'},error:null})
  await expect(queueRecoveryDraft({...scope,message})).rejects.toThrow('final_message_unbound');expect(io.queue).not.toHaveBeenCalled();expect(io.lifecycle).not.toHaveBeenCalled()
 })
 it('rechecks immutable recovery authority before lifecycle/outbox writes',async()=>{
  io.rpc.mockImplementation(async(name:string)=>name==='ediel_require_prodat_recovery_current_v1'?{data:null,error:{message:'held_current_source'}}:{data:{status:'reserved',intentId:'new-intent',outboundRequestId:'chosen-request',messageId:'new-message'},error:null})
  await expect(queueRecoveryDraft({...scope,message})).rejects.toEqual({message:'held_current_source'});expect(io.queue).not.toHaveBeenCalled();expect(io.lifecycle).not.toHaveBeenCalled()
 })
 it('queues only exact own validated intent and keeps its lifecycle',async()=>{
  await queueRecoveryDraft({...scope,message});expect(io.queue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({messageId:'new-message',intentId:'new-intent',outboundRequestId:'chosen-request'}));expect(io.lifecycle).toHaveBeenLastCalledWith('new-intent',{outboxStatus:'queued',actorUserId:'actor'})
  io.intent.mockResolvedValue({...intent,operationId:'other-operation'});io.queue.mockClear()
  await expect(queueRecoveryDraft({...scope,message})).rejects.toThrow('current_intent_required');expect(io.queue).not.toHaveBeenCalled()
 })
 it('binds the corrected switch operative source before queue and holds on native rejection',async()=>{
  io.intent.mockResolvedValue({...intent,messageCode:'Z03',businessProcess:'supplier_switch',supplierSwitchRequestId:'switch'})
  const corrected={...message,message_code:'Z03',switch_request_id:'switch'}
  io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_reserve_prodat_recovery_origin_v1'?{status:'reserved',intentId:'new-intent',outboundRequestId:'chosen-request',messageId:'new-message'}:name==='ediel_bind_switch_correction_v1'?{status:'bound',messageId:'new-message'}:null,error:null}))
  await queueRecoveryDraft({...scope,message:corrected})
  const binding=io.rpc.mock.calls.findIndex(([name])=>name==='ediel_bind_switch_correction_v1')
  expect(binding).toBeGreaterThan(-1);expect(io.rpc.mock.invocationCallOrder[binding]).toBeLessThan(io.queue.mock.invocationCallOrder[0])
  io.queue.mockClear();io.rpc.mockImplementation(async(name:string)=>name==='ediel_bind_switch_correction_v1'?{data:null,error:{message:'qualified_source_changed'}}:{data:{status:'reserved',intentId:'new-intent',outboundRequestId:'chosen-request',messageId:'new-message'},error:null})
  await expect(queueRecoveryDraft({...scope,message:corrected})).rejects.toEqual({message:'qualified_source_changed'});expect(io.queue).not.toHaveBeenCalled()
 })
})
