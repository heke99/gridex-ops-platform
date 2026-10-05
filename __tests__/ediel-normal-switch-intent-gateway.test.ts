import {beforeEach,describe,expect,it,vi} from 'vitest'
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
const message={...source('raw'),id:'message',company_id:'tenant',intent_id:'intent',outbound_request_id:'request',message_code:'Z03',direction:'outbound' as const,status:'draft' as const}
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
describe('normal switch intent-before-render and original binding',()=>{
 it('renders exact stored references then binds native before queue',async()=>{
  await renderAndQueueNormalSwitch(await input())
  expect(io.render.mock.calls[0][0].wireReferences).toEqual({documentReference:'EXACT-BGM',transactionReference:'EXACT-LI',interchangeReference:'EXACT-UNB',messageReference:'EXACT-UNH'})
  expect(io.intent.mock.invocationCallOrder[0]).toBeLessThan(io.render.mock.invocationCallOrder[0])
  expect(io.finalize.mock.calls[0][0].draft).toMatchObject({intentId:'intent',sourceOperationId:'switch',parsedPayload:{prodatVariant:'LK',reasonForTransaction:'Z23',canonical_rule_pack_id:'pack'}})
  expect(io.lifecycle).toHaveBeenNthCalledWith(1,'intent',expect.objectContaining({edielMessageId:'message',outboundRequestId:'request',renderStatus:'rendered'}))
  expect(io.rpc).toHaveBeenCalledWith('ediel_bind_switch_original_v1',{p_company_id:'tenant',p_switch_id:'switch',p_message_id:'message',p_actor_user_id:'actor'})
  expect(io.rpc.mock.invocationCallOrder[0]).toBeLessThan(io.queue.mock.invocationCallOrder[0])
 })
 it('blocks before rendering on rejected intent or a different route scope',async()=>{
  io.validate.mockReturnValue({ok:false});await expect(renderAndQueueNormalSwitch(await input())).rejects.toThrow('validated_source_intent');expect(io.render).not.toHaveBeenCalled()
  io.validate.mockReturnValue({ok:true});io.intent.mockResolvedValue({...intent,communicationRouteId:'other'});await expect(renderAndQueueNormalSwitch(await input())).rejects.toThrow('validated_source_intent');expect(io.render).not.toHaveBeenCalled()
 })
 it('native source rejection never queues or advances outbox lifecycle',async()=>{
  io.rpc.mockResolvedValue({data:null,error:{message:'source_changed'}})
  await expect(renderAndQueueNormalSwitch(await input())).rejects.toEqual({message:'source_changed'});expect(io.queue).not.toHaveBeenCalled();expect(io.lifecycle).not.toHaveBeenCalledWith('intent',expect.objectContaining({outboxStatus:'queued'}))
 })
 it('returns an already sent own original without render, native rebinding or requeue',async()=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.message.mockResolvedValue({...message,status:'acknowledged'})
  expect((await renderAndQueueNormalSwitch(await input())).status).toBe('acknowledged');expect(io.render).not.toHaveBeenCalled();expect(io.rpc).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
 it('never queues a generic dedupe row linked to another intent/request',async()=>{
  io.finalize.mockResolvedValue({...message,intent_id:'other'})
  await expect(renderAndQueueNormalSwitch(await input())).rejects.toThrow('binding_conflict');expect(io.rpc).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
})
