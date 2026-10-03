// masterplan: TEN-01, TEN-02
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({actor:vi.fn()}))
vi.mock('@/lib/ediel/core/actorRegistry',()=>({resolveCanonicalActorContext:io.actor}))
import {assertOutboundActorIdentity,buildOutboundExecutionContext} from '@/lib/ediel/core/outboundExecutionContext'
import type {CreateEdielMessageInput} from '@/lib/ediel/types'
const company='00000000-0000-4000-8000-000000000001'
const draft=(patch:Partial<CreateEdielMessageInput>={}):CreateEdielMessageInput=>({actorUserId:'u',companyId:company,direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z13',
 environment:'test',senderEdielId:'7300000000009',receiverEdielId:'7300000000002',applicationReference:'23-DGI-PRODAT',communicationRouteId:'route',routeProfileId:'profile',sourceOperationId:'op',rawPayload:'UNB',...patch})
const actor=(patch:Record<string,unknown>={})=>({actor:{id:'actor-esco'},actorRole:'energy_service_company',senderEdielId:'7300000000009',legalActorEdielId:'7300000000001',transportActorEdielId:'7300000000009',senderSubAddress:null,marketRoles:['energy_service_company'],...patch})
beforeEach(()=>{io.actor.mockReset().mockResolvedValue(actor())})
describe('verified outbound execution context before customer mutation',()=>{
 it('resolves the tenant role profile from the process and keeps tenant, legal actor, role and transport identity distinct',async()=>{
  const resolved=await assertOutboundActorIdentity(draft())
  expect(io.actor).toHaveBeenCalledWith('test',company,'energy_service_company')
  const context=buildOutboundExecutionContext({draft:draft(),actor:resolved,rulePackId:'pack'})
  expect(context).toMatchObject({companyId:company,senderActorId:'actor-esco',senderRole:'energy_service_company',legalActorEdielId:'7300000000001',senderEdielId:'7300000000009',family:'PRODAT',messageCode:'Z13'})
  expect(Object.isFrozen(context)).toBe(true)
 })
 it('rejects a business draft whose process role cannot be derived instead of defaulting a role',async()=>{
  await expect(assertOutboundActorIdentity(draft({applicationReference:null}))).rejects.toThrow('canonical_outbound_process_role_unresolved')
  expect(io.actor).not.toHaveBeenCalled()
 })
 it('rejects a wire sender that is not the transport identity of the tenant role profile',async()=>{
  await expect(assertOutboundActorIdentity(draft({senderEdielId:'7300000000777'}))).rejects.toThrow('canonical_outbound_sender_identity_mismatch')
 })
 it('propagates a missing tenant market role as a refusal',async()=>{
  io.actor.mockRejectedValue(new Error('canonical_actor_market_role_missing:energy_service_company'))
  await expect(assertOutboundActorIdentity(draft())).rejects.toThrow('canonical_actor_market_role_missing')
 })
 it('rejects an incomplete identity context such as a missing receiver or rule pack',()=>{
  expect(()=>buildOutboundExecutionContext({draft:draft({receiverEdielId:null}),actor:actor() as never,rulePackId:'pack'})).toThrow(/execution context/)
  expect(()=>buildOutboundExecutionContext({draft:draft(),actor:actor() as never,rulePackId:''})).toThrow(/execution context/)
  expect(()=>buildOutboundExecutionContext({draft:draft({senderEdielId:'7300000000002'}),actor:actor() as never,rulePackId:'pack'})).toThrow(/execution context/)
 })
 it('does not gate technical families that have no market role profile',async()=>{
  expect(await assertOutboundActorIdentity(draft({messageFamily:'AI_LIST' as never,applicationReference:null}))).toBeNull()
  expect(io.actor).not.toHaveBeenCalled()
 })
})
