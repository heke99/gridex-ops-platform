import {beforeEach,describe,expect,it,vi} from 'vitest'
const uid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const m=vi.hoisted(()=>({authorize:vi.fn(),coordinate:vi.fn(),resolve:vi.fn(),origin:vi.fn(),route:vi.fn(),intent:vi.fn(),createRequest:vi.fn(),gateway:vi.fn(),from:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:m.from}}))
vi.mock('@/lib/cis/db',()=>({createOutboundRequest:m.createRequest}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:m.authorize}))
vi.mock('@/lib/ediel/services/commands',()=>({coordinateEdielServicePermission:m.coordinate,resolveEdielServicePermissionCommand:m.resolve}))
vi.mock('@/lib/ediel/services/permissionOrigin',()=>({readServicePermissionOrigin:m.origin}))
vi.mock('@/lib/ediel/core/kernel',()=>({resolveCanonicalOutboundContext:m.route}))
vi.mock('@/lib/ediel/intent/intentEngine',()=>({createEdielMessageIntent:m.intent}))
vi.mock('@/lib/ediel/intent/renderGateway',()=>({renderAndQueueServicePermission:m.gateway}))
import {prepareAndQueueServicePermissionZ13} from '@/lib/ediel/flows/prodatServicePermission'
const input={providerCompanyId:uid(1),actorUserId:uid(2),assignmentId:uid(3),expectedVersion:1,permissionId:uid(4)}
beforeEach(()=>{vi.resetAllMocks();m.authorize.mockResolvedValue(undefined);m.coordinate.mockResolvedValue({status:'permission_required',permissionId:uid(4)});m.resolve.mockResolvedValue({status:'permission_required',permissionId:uid(4)});m.origin.mockResolvedValue({status:'authorized',companyId:uid(1),permissionId:uid(4),assignmentId:uid(3),providerActorId:uid(5),legalSenderId:'21660',legalReceiverId:'54321',environment:'test',customerId:uid(6),code:'Z13'});m.route.mockResolvedValue({actor:{tenantIdentity:{legalActorId:uid(5)},legalActorEdielId:'21660',marketRoles:['energy_service_company']},route:{id:uid(8)},routeRuntime:{route_profile_id:uid(9)},senderEdielId:'21660',receiverEdielId:'54321'});m.intent.mockResolvedValue({id:uid(10)});const query:{[key:string]:unknown}={};for(const name of ['select','eq','contains','order'])query[name]=vi.fn(()=>query);query.limit=vi.fn(async()=>({data:[{id:uid(11),company_id:uid(1)}],error:null}));m.from.mockReturnValue(query);m.gateway.mockResolvedValue({status:'queued',message:{id:uid(12)}})})
describe('actual service producer command consumption (declared source ports)',()=>{
 for(const marketPermissionState of ['approved','pending'])it(`stops ${marketPermissionState} reuse before any route/render/intent/outbox`,async()=>{
  const result={status:'reuse_permission',permissionId:uid(4),marketPermissionState,accessGranted:false};m.resolve.mockResolvedValue(result);expect(await prepareAndQueueServicePermissionZ13(input)).toEqual(result)
  for(const fn of [m.origin,m.route,m.intent,m.from,m.createRequest,m.gateway])expect(fn).not.toHaveBeenCalled()
 })
 it('continues its genuinely unfinished first request through the existing canonical gateway',async()=>{
  expect(await prepareAndQueueServicePermissionZ13(input)).toEqual({status:'queued',message:{id:uid(12)}});expect(m.gateway).toHaveBeenCalledWith(expect.objectContaining({intentId:uid(10),outboundRequestId:uid(11),origin:expect.objectContaining({permissionId:uid(4)})}))
 })
 it('resumes the exact bound first draft after a pre-queue crash, with the old intent/request',async()=>{
  m.resolve.mockResolvedValue({status:'permission_required',permissionId:uid(4),messageId:uid(12),intentId:uid(10),outboundRequestId:uid(11)});await prepareAndQueueServicePermissionZ13(input)
  expect(m.gateway).toHaveBeenCalledWith(expect.objectContaining({intentId:uid(10),outboundRequestId:uid(11)}));expect(m.createRequest).not.toHaveBeenCalled()
 })
 for(const mismatch of ['intent','request'])it(`rejects a ${mismatch} mismatch rather than linking or queuing another original`,async()=>{
  m.resolve.mockResolvedValue({status:'permission_required',permissionId:uid(4),messageId:uid(12),intentId:mismatch==='intent'?uid(99):uid(10),outboundRequestId:mismatch==='request'?uid(99):uid(11)})
  await expect(prepareAndQueueServicePermissionZ13(input)).rejects.toThrow(`resume_${mismatch}_mismatch`);expect(m.gateway).not.toHaveBeenCalled()
 })
 it('does not treat a native source error or held assignment as permission to originate',async()=>{
  m.resolve.mockResolvedValue({status:'held',missing:['actual_source_required']});expect((await prepareAndQueueServicePermissionZ13(input)).status).toBe('held');expect(m.gateway).not.toHaveBeenCalled()
  m.resolve.mockRejectedValue(new Error('native_source_failure'));await expect(prepareAndQueueServicePermissionZ13(input)).rejects.toThrow('native_source_failure');expect(m.gateway).not.toHaveBeenCalled()
 })
})
