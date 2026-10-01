import { describe, it, expect, vi, beforeEach } from 'vitest'
const mocks=vi.hoisted(()=>({reserve:vi.fn(),load:vi.fn(),validate:vi.fn(),update:vi.fn(),build:vi.fn(),finalize:vi.fn(),queue:vi.fn(),message:vi.fn()}))
vi.mock('@/lib/ediel/flows/shared',()=>({finalizeOutboundDraft:mocks.finalize,queuePreparedEdielMessage:mocks.queue}))
vi.mock('@/lib/ediel/intent/intentEngine',()=>({getEdielMessageIntentById:mocks.load,evaluateIntentValidation:mocks.validate,updateIntentLifecycle:mocks.update}))
vi.mock('@/lib/ediel/intent/renderers/servicePermission',()=>({buildServicePermissionDraft:mocks.build}))
vi.mock('@/lib/ediel/services/permissionOrigin',()=>({reserveServicePermissionOrigin:mocks.reserve}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:mocks.message}))
vi.mock('@/lib/supabase/tenantDb',()=>({tenantDb:vi.fn()}))
import { renderAndQueueServicePermission } from '@/lib/ediel/intent/renderGateway'
const input={intentId:'new-termination-intent',origin:{providerCompanyId:'tenant',permissionId:'permission',actorUserId:'actor',code:'Z18'},basis:{code:'Z18'},routeContext:{receiverEdielId:'54321'},outboundRequestId:'new-command-request'} as Parameters<typeof renderAndQueueServicePermission>[0]
describe('source permission gateway command identity',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.load.mockResolvedValue({id:input.intentId});mocks.validate.mockReturnValue({ok:true});mocks.build.mockResolvedValue({messageVersion:'26.A'});mocks.update.mockResolvedValue(undefined);mocks.queue.mockResolvedValue(undefined)})
 it('holds a canonical duplicate from an earlier sent Z18 without linking or queueing it',async()=>{
  const old={id:'old-sent-message',company_id:'tenant',intent_id:'old-intent',outbound_request_id:'old-request',status:'sent'}
  mocks.reserve.mockResolvedValue({status:'reserved',messageId:null});mocks.finalize.mockResolvedValue(old)
  const result=await renderAndQueueServicePermission(input)
  expect(result.status).toBe('blocked');expect(mocks.queue).not.toHaveBeenCalled()
  expect(mocks.update.mock.calls.some(([,update])=>update.edielMessageId===old.id)).toBe(false)
  expect(old.status).toBe('sent')
  expect(mocks.finalize.mock.calls[0][0].duplicateCheck.sourceId).toBe(input.intentId)
 })
 it('resumes only the private-bound first draft and preserves its established result on replay',async()=>{
  const current={id:'own-first-draft',company_id:'tenant',intent_id:input.intentId,outbound_request_id:input.outboundRequestId,status:'draft',external_reference:'OWN-FIRST-LI'}
  mocks.reserve.mockResolvedValue({status:'reserved',messageId:current.id});mocks.message.mockResolvedValue(current)
  mocks.queue.mockImplementation(async()=>{current.status='queued'})
  expect((await renderAndQueueServicePermission({...input,origin:{...input.origin,code:'Z13'}})).status).toBe('queued')
  expect(mocks.build).not.toHaveBeenCalled();expect(mocks.finalize).not.toHaveBeenCalled();expect(mocks.queue).toHaveBeenCalledOnce()
  expect((await renderAndQueueServicePermission({...input,origin:{...input.origin,code:'Z13'}})).status).toBe('existing')
  expect(mocks.queue).toHaveBeenCalledOnce();expect(current.status).toBe('queued')
 })
 it('queues only the current command message after a separate source cancelled termination cycle',async()=>{
  const current={id:'new-cycle-message',company_id:'tenant',intent_id:input.intentId,outbound_request_id:input.outboundRequestId,status:'draft',external_reference:'NEW-LI'}
  mocks.reserve.mockResolvedValueOnce({status:'reserved',messageId:null}).mockResolvedValueOnce({status:'reserved',messageId:current.id});mocks.finalize.mockResolvedValue(current)
  const result=await renderAndQueueServicePermission(input)
  expect(result.status).toBe('queued');expect(mocks.queue).toHaveBeenCalledOnce()
  expect(mocks.queue.mock.calls[0][0]).toMatchObject({messageId:current.id,intentId:input.intentId,outboundRequestId:input.outboundRequestId})
 })
})
