import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {renderAndQueueNormalSwitch} from '@/lib/ediel/intent/switchRenderGateway'
import {resolveDecisionBackedOutboundContext} from '@/lib/ediel/flows/routeDecisionContext'
import {getSupplierSwitchRequestById} from '@/lib/operations/db'
import {getCustomerSiteById,getMeteringPointById} from '@/lib/masterdata/db'
import {makeServerClient} from '@/lib/ediel/flows/shared'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'
import {source} from './fixtures/prodat-identity'
const io=vi.hoisted(()=>({intent:vi.fn(),validate:vi.fn(),render:vi.fn(),finalize:vi.fn(),queue:vi.fn(),lifecycle:vi.fn(),rpc:vi.fn(),message:vi.fn(),route:vi.fn(),switch:vi.fn(),site:vi.fn(),point:vi.fn()}))
vi.mock('@/lib/ediel/intent/intentEngine',()=>({getEdielMessageIntentById:io.intent,evaluateIntentValidation:io.validate,updateIntentLifecycle:io.lifecycle}))
vi.mock('@/lib/ediel/prodat',()=>({buildProdatZ03FromSwitch:io.render}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:io.message}))
vi.mock('@/lib/ediel/flows/shared',()=>({finalizeOutboundDraft:io.finalize,queuePreparedEdielMessage:io.queue,makeServerClient:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/flows/routeDecisionContext',()=>({resolveDecisionBackedOutboundContext:io.route}))
vi.mock('@/lib/operations/db',()=>({getSupplierSwitchRequestById:io.switch}))
vi.mock('@/lib/masterdata/db',()=>({getCustomerSiteById:io.site,getMeteringPointById:io.point}))
const intent:EdielMessageIntent={id:'intent',companyId:'tenant',environment:'test',market:'electricity',messageFamily:'PRODAT',messageCode:'Z03',businessProcess:'supplier_switch',direction:'outbound',senderEdielId:'111',receiverEdielId:'222',applicationReference:'23-DDQ-PRODAT',routeProfileId:'profile',communicationRouteId:'route',customerId:'customer',customerSiteId:'site',supplierSwitchRequestId:'switch',operationId:'switch',interchangeReference:'EXACT-UNB',messageReference:'EXACT-UNH',transactionReference:'EXACT-LI',payload:{documentReference:'EXACT-BGM',transactionSubtype:'LK',reasonForTransaction:'Z23',canonical_rule_pack_id:'pack',canonical_message_profile_id:'message-profile',canonical_profile_key:'profile-key'},idempotencyKey:'switch',validationStatus:'validated',renderStatus:'not_rendered',outboxStatus:'not_queued'}
const message={...source('raw'),id:'message',company_id:'tenant',intent_id:'intent',outbound_request_id:'request',message_code:'Z03',direction:'outbound' as const,status:'draft' as const,immutable_payload_hash:createHash('sha256').update('raw').digest('hex'),immutable_rendered_at:'2026-10-25T12:00:00Z'}
// These mocked projections are mechanical gateway inputs, not authentic
// contracts, market approval or native source proof. The native binding RPC is
// the independently tested source boundary.
async function input(){
 const client=await makeServerClient(),switchRequest=await getSupplierSwitchRequestById(client,'switch'),site=await getCustomerSiteById(client,'site'),meteringPoint=await getMeteringPointById(client,'point')
 if(!switchRequest||!site||!meteringPoint)throw new Error('fixture_scope_required')
 const routeContext=await resolveDecisionBackedOutboundContext({companyId:'tenant',environment:'test',requestType:'supplier_switch',messageFamily:'PRODAT',messageCode:'Z03'})
 return {intentId:'intent',actorUserId:'actor',outboundRequestId:'request',routeContext,source:{senderEdielId:'111',receiverEdielId:'222',switchRequest,site,meteringPoint}}
}
beforeEach(()=>{vi.resetAllMocks();io.intent.mockResolvedValue(intent);io.validate.mockReturnValue({ok:true});io.switch.mockResolvedValue({id:'switch',company_id:'tenant',customer_id:'customer',site_id:'site'});io.site.mockResolvedValue({id:'site'});io.point.mockResolvedValue({id:'point'});io.route.mockResolvedValue({environment:'test',route:{id:'route'},routeDecision:{edielRouteProfileId:'profile'},senderEdielId:'111',receiverEdielId:'222'});io.render.mockResolvedValue({messageFamily:'PRODAT',messageCode:'Z03',messageVersion:'version',rawPayload:'raw'});io.finalize.mockResolvedValue(message);io.rpc.mockResolvedValue({data:{status:'bound',messageId:'message'},error:null})})

// Consumer/component proof only: native RPC validation/transactions are separate.
const queued={status:'queued',messageId:'message',outboxId:'00000000-0000-4000-8000-000000000012',authorizesProviderEntry:false,deliveryProven:false}
beforeEach(()=>{
 io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_bind_switch_original_v1'?{status:'bound',messageId:'message'}:queued,error:null}))
 io.message.mockResolvedValue({...message,status:'queued'})
})
describe('installed atomic normal-switch enqueue consumer',()=>{
 it('reports the fresh draft transition separately from the real queued message status',async()=>{
  const result=await renderAndQueueNormalSwitch(await input())
  expect(result).toMatchObject({queuedFromDraft:true,message:{id:'message',status:'queued'}})
 })
 it.each(['queued','sending','sent'])('does not report a fresh transition for an existing %s original',async status=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.message.mockResolvedValue({...message,status})
  io.rpc.mockResolvedValue({data:{...queued,status:status==='sent'?'accepted':'in_progress'},error:null})
  expect(await renderAndQueueNormalSwitch(await input())).toMatchObject({queuedFromDraft:false,message:{id:'message',status}})
  expect(io.render).not.toHaveBeenCalled();expect(io.lifecycle).not.toHaveBeenCalled()
 })
 it('does not report a fresh queued transition when concurrent acceptance wins',async()=>{
  io.message.mockResolvedValue({...message,status:'sent'})
  io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_bind_switch_original_v1'?{status:'bound',messageId:'message'}:{...queued,status:'accepted'},error:null}))
  expect(await renderAndQueueNormalSwitch(await input())).toMatchObject({queuedFromDraft:false,message:{id:'message',status:'sent'}})
 })
 it('uses the exact generated RPC arguments after native binding, with no split queue writes',async()=>{
  expect((await renderAndQueueNormalSwitch(await input())).message.status).toBe('queued')
  expect(io.rpc.mock.calls.map(c=>c[0])).toEqual(['ediel_bind_switch_original_v1','gridex_enqueue_normal_supplier_switch_v1'])
  expect(io.rpc).toHaveBeenLastCalledWith('gridex_enqueue_normal_supplier_switch_v1',{
   p_company_id:'tenant',p_switch_id:'switch',p_intent_id:'intent',p_message_id:'message',p_outbound_request_id:'request',p_actor_user_id:'actor',p_expected_payload_hash:message.immutable_payload_hash})
  expect(io.queue).not.toHaveBeenCalled()
  expect(io.lifecycle).not.toHaveBeenCalledWith('intent',expect.objectContaining({outboxStatus:'queued'}))
 })
 it.each(['queued','prepared','sent'])('checks the SAME bound original on replay from %s without rendering/rebinding',async status=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.message.mockResolvedValueOnce({...message,status}).mockResolvedValue({...message,status:status==='sent'?'sent':'queued'})
  io.rpc.mockResolvedValue({data:{...queued,status:status==='sent'?'accepted':'queued'},error:null})
  await renderAndQueueNormalSwitch(await input())
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('gridex_enqueue_normal_supplier_switch_v1',expect.objectContaining({p_message_id:'message'}))
  expect(io.render).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(io.lifecycle).not.toHaveBeenCalled()
 })
 it('holds a queued original without a durable commit instead of returning false success',async()=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.rpc.mockResolvedValue({data:{status:'held',reason:'existing_transport_history',authorizesProviderEntry:false,deliveryProven:false},error:null})
  await expect(renderAndQueueNormalSwitch(await input())).rejects.toThrow('switch_original_atomic_enqueue_unconfirmed')
  expect(io.render).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
 it.each([null,{}, {...queued,status:['queued']}, {...queued,status:'held'}, {...queued,messageId:'another'}, {...queued,authorizesProviderEntry:true}, {...queued,deliveryProven:true}, {...queued,outboxId:null}, {...queued,outboxId:'not-an-outbox'}, {...queued,status:'other'}])('fails closed for invalid atomic outcome %j',async data=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.rpc.mockResolvedValue({data,error:null})
  await expect(renderAndQueueNormalSwitch(await input())).rejects.toThrow('switch_original_atomic_enqueue_unconfirmed')
  expect(io.render).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(io.lifecycle).not.toHaveBeenCalled()
 })
 it('propagates an unknown RPC outcome without a second call or fallback queue',async()=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.rpc.mockRejectedValue(new Error('unknown outcome'))
  await expect(renderAndQueueNormalSwitch(await input())).rejects.toThrow('unknown outcome')
  expect(io.rpc).toHaveBeenCalledTimes(1);expect(io.queue).not.toHaveBeenCalled();expect(io.render).not.toHaveBeenCalled()
 })
 it.each(['raw_payload','immutable_payload_hash','immutable_rendered_at'])('refuses absent immutable original %s before any native call',async field=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.message.mockResolvedValue({...message,[field]:null})
  await expect(renderAndQueueNormalSwitch(await input())).rejects.toThrow('switch_original_immutable_payload_required')
  expect(io.rpc).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(io.render).not.toHaveBeenCalled()
 })
 it('refuses original hash drift without replacing bytes',async()=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.message.mockResolvedValue({...message,raw_payload:'different'})
  await expect(renderAndQueueNormalSwitch(await input())).rejects.toThrow('switch_original_immutable_payload_required');expect(io.rpc).not.toHaveBeenCalled()
 })
 it('requires a persisted readback from the confirmed original',async()=>{
  io.message.mockResolvedValue(null)
  await expect(renderAndQueueNormalSwitch(await input())).rejects.toThrow('switch_original_atomic_enqueue_readback_unconfirmed')
  expect(io.queue).not.toHaveBeenCalled()
 })
 it.each(['company_id','intent_id','outbound_request_id'])('rejects a cross-scope persisted readback %s',async field=>{
  io.message.mockResolvedValue({...message,status:'queued',[field]:'foreign'})
  await expect(renderAndQueueNormalSwitch(await input())).rejects.toThrow('switch_original_atomic_enqueue_readback_unconfirmed')
  expect(io.queue).not.toHaveBeenCalled()
 })
 it.each(['L','LK','H'])('retains the normal %s gateway without using a generic queue',async subtype=>{
  io.intent.mockResolvedValue({...intent,payload:{...intent.payload,transactionSubtype:subtype}})
  await renderAndQueueNormalSwitch(await input());expect(io.rpc).toHaveBeenCalledWith('gridex_enqueue_normal_supplier_switch_v1',expect.objectContaining({p_intent_id:'intent'}));expect(io.queue).not.toHaveBeenCalled()
 })
 it('observes an existing active claim without a new bind, render or queue',async()=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.message.mockResolvedValueOnce({...message,status:'queued'}).mockResolvedValue({...message,status:'dispatching'})
  io.rpc.mockResolvedValue({data:{...queued,status:'in_progress'},error:null})
  expect((await renderAndQueueNormalSwitch(await input())).message.status).toBe('dispatching');expect(io.rpc).toHaveBeenCalledTimes(1);expect(io.lifecycle).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })

})
