import {beforeEach,describe,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({authorize:vi.fn(),intent:vi.fn(),lifecycle:vi.fn(),render:vi.fn(),finalize:vi.fn(),queue:vi.fn(),message:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:mocks.authorize}))
vi.mock('@/lib/ediel/intent/intentEngine',()=>({getEdielMessageIntentById:mocks.intent,evaluateIntentValidation:()=>({ok:true}),updateIntentLifecycle:mocks.lifecycle}))
vi.mock('@/lib/ediel/intent/renderers/aiList',()=>({buildAiListIntentDraft:mocks.render}))
vi.mock('@/lib/ediel/flows/shared',()=>({finalizeOutboundDraft:mocks.finalize,queuePreparedEdielMessage:mocks.queue}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:mocks.message}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(...args:unknown[])=>({abortSignal:()=>mocks.rpc(...args)})}}))
import {renderAndQueueAiList} from '@/lib/ediel/intent/aiListGateway'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',intentId='00000000-0000-4000-8000-000000000003'
const route={environment:'test',senderEdielId:'12345',receiverEdielId:'54321',route:{id:'route'},receiverEmail:'network@example.test',mailbox:'actual-mailbox'} as unknown as Parameters<typeof renderAndQueueAiList>[0]['routeContext']
const message={id:'message',company_id:company,intent_id:intentId,immutable_payload_hash:'a'.repeat(64),status:'draft',external_reference:null}
beforeEach(()=>{
 vi.clearAllMocks();mocks.authorize.mockResolvedValue(undefined);mocks.intent.mockResolvedValue({id:intentId,companyId:company,environment:'test',messageFamily:'AI_LIST',messageCode:'AI',senderEdielId:'12345',receiverEdielId:'54321',communicationRouteId:'route',customerId:'customer',customerSiteId:'site',routeProfileId:'profile',payload:{fromDate:'20261001',toDate:'20261101'}})
 mocks.render.mockResolvedValue({draft:{rawPayload:'fresh-source-owned-CSV',fileName:'AI.csv',mimeType:'text/csv'},basis:{history:{evidence:{snapshotId:'snapshot',readsetHash:'b'.repeat(64),rowSources:[]}}}})
 mocks.rpc.mockImplementation(async name=>({data:name==='gridex_ai_outbound_origin_status_v1'?{status:'new'}:{status:'original'},error:null}));mocks.finalize.mockResolvedValue(message)
})
describe('actual AI intent/render/original/finalize/outbox chain',()=>{
 it('records only a freshly recomputed complete source snapshot before actual message persistence and queues the same intent',async()=>{
  await renderAndQueueAiList({companyId:company,actorUserId:actor,intentId,routeContext:route})
  expect(mocks.render).toHaveBeenCalledTimes(1)
  expect(mocks.rpc).toHaveBeenCalledWith('gridex_ai_record_outbound_original_v1',expect.objectContaining({p_company_id:company,p_intent_id:intentId,p_snapshot_id:'snapshot',p_readset_hash:'b'.repeat(64),p_raw_payload:'fresh-source-owned-CSV'}))
  expect(mocks.finalize).toHaveBeenCalledTimes(1);expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({messageId:'message',intentId}))
 })
 it('keeps WRITE-only fresh preparation without a new READ prerequisite',async()=>{
  mocks.authorize.mockImplementation(async input=>{if(!input.permissionAnyOf.includes('communication.write'))throw Error('read permission absent')})
  await renderAndQueueAiList({companyId:company,actorUserId:actor,intentId,routeContext:route})
  expect(mocks.render).toHaveBeenCalledTimes(1);expect(mocks.finalize).toHaveBeenCalledTimes(1)
 })
 it('does not persist or queue when the own original receipt is unconfirmed',async()=>{
  mocks.rpc.mockImplementation(async name=>({data:name==='gridex_ai_outbound_origin_status_v1'?{status:'new'}:null,error:null}))
  await expect(renderAndQueueAiList({companyId:company,actorUserId:actor,intentId,routeContext:route})).rejects.toThrow('ai_list_original_receipt_unconfirmed')
  expect(mocks.finalize).not.toHaveBeenCalled();expect(mocks.queue).not.toHaveBeenCalled()
 })
 it('reuses the bound immutable original instead of rendering or replacing historical rows',async()=>{
  mocks.rpc.mockResolvedValue({data:{status:'bound',messageId:'message',payloadHash:'a'.repeat(64)},error:null});mocks.message.mockResolvedValue({...message,status:'sent'})
  await renderAndQueueAiList({companyId:company,actorUserId:actor,intentId,routeContext:route})
  expect(mocks.render).not.toHaveBeenCalled();expect(mocks.finalize).not.toHaveBeenCalled();expect(mocks.queue).not.toHaveBeenCalled()
 })
 it('returns the bound original before today route/write/render checks without status reset',async()=>{
  mocks.rpc.mockResolvedValue({data:{status:'bound',messageId:'message',payloadHash:'a'.repeat(64)},error:null});mocks.message.mockResolvedValue(message)
  mocks.authorize.mockImplementation(async input=>{if(!input.permissionAnyOf.includes('communication.read'))throw Error('current writer revoked')})
  const changedRoute={...route,senderEdielId:'TODAY-OTHER',receiverEdielId:'TODAY-REMOVED'}
  expect(await renderAndQueueAiList({companyId:company,actorUserId:actor,intentId,routeContext:changedRoute})).toBe(message)
  expect(mocks.render).not.toHaveBeenCalled();expect(mocks.finalize).not.toHaveBeenCalled();expect(mocks.queue).not.toHaveBeenCalled();expect(mocks.lifecycle).not.toHaveBeenCalled()
 })
 it('does not disclose a foreign or mismatched frozen original',async()=>{
  mocks.rpc.mockResolvedValue({data:{status:'bound',messageId:'message',payloadHash:'a'.repeat(64)},error:null});mocks.message.mockResolvedValue({...message,company_id:'foreign'})
  await expect(renderAndQueueAiList({companyId:company,actorUserId:actor,intentId,routeContext:route})).rejects.toThrow('ai_list_existing_original_scope_mismatch')
  expect(mocks.queue).not.toHaveBeenCalled()
 })
 it('uses the protected tenant/intent port before reading shared intent data',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:Error('foreign intent')})
  await expect(renderAndQueueAiList({companyId:company,actorUserId:actor,intentId,routeContext:route})).rejects.toThrow('ai_list_original_status_unconfirmed')
  expect(mocks.intent).not.toHaveBeenCalled();expect(mocks.render).not.toHaveBeenCalled();expect(mocks.finalize).not.toHaveBeenCalled()
 })
 it('keeps current actor and exact tenant/intent/route scope before any source read or writer',async()=>{
  mocks.authorize.mockRejectedValue(new Error('ediel_tenant_actor_forbidden'))
  await expect(renderAndQueueAiList({companyId:company,actorUserId:actor,intentId,routeContext:route})).rejects.toThrow('ediel_tenant_actor_forbidden')
  expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.render).not.toHaveBeenCalled()
 })
})
