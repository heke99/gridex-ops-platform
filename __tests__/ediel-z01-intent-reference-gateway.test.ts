import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {EdielMessageIntent} from '@/lib/ediel/intent/types'
import {renderAndQueueFacilityLookupZ01,renderAndQueueCustomerMasterdataZ01} from '@/lib/ediel/intent/renderGateway'
import type {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernel'
import type {CreateEdielMessageInput} from '@/lib/ediel/types'
import {source} from './fixtures/prodat-identity'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {readZ01OriginalForRequest} from '@/lib/ediel/prodat/z01OriginalReplay'
const io=vi.hoisted(()=>({intent:vi.fn(),validate:vi.fn(),lifecycle:vi.fn(),facility:vi.fn(),customer:vi.fn(),finalize:vi.fn(),queue:vi.fn(),link:vi.fn(),patch:vi.fn(),message:vi.fn(),actor:vi.fn(),source:vi.fn(),outboundRead:vi.fn(),orphanRead:vi.fn(),query:vi.fn()}))
vi.mock('@/lib/ediel/intent/intentEngine',()=>({getEdielMessageIntentById:io.intent,evaluateIntentValidation:io.validate,updateIntentLifecycle:io.lifecycle}))
vi.mock('@/lib/ediel/intent/renderers/facilityLookupZ01',()=>({buildFacilityLookupZ01Draft:io.facility}))
vi.mock('@/lib/ediel/intent/renderers/customerMasterdataZ01',()=>({buildCustomerMasterdataZ01Draft:io.customer}))
vi.mock('@/lib/ediel/flows/shared',()=>({finalizeOutboundDraft:io.finalize,queuePreparedEdielMessage:io.queue}))
vi.mock('@/lib/ediel/db',()=>({linkEdielMessage:io.link,getEdielMessageById:io.message}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:io.actor}))
vi.mock('@/lib/ediel/core/sourceRulePackEvidence',()=>({requireEdielSourceRulePackEvidence:io.source}))
vi.mock('@/lib/supabase/tenantDb',()=>({tenantDb:()=>({companyId:'company',unscoped:()=>({from:()=>({update:()=>({eq:()=>({eq:io.patch})}),select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:{facility_id:'735123456789012345'},error:null})})})})})})})}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.query}}))
vi.mock('@/lib/ediel/services/permissionOrigin',()=>({reserveServicePermissionOrigin:vi.fn()}))
vi.mock('@/lib/ediel/intent/renderers/servicePermission',()=>({buildServicePermissionDraft:vi.fn()}))
vi.mock('@/lib/ediel/services/reporting',()=>({buildServiceReportingContext:vi.fn()}))
const intent:EdielMessageIntent={id:'intent',companyId:'company',environment:'test',market:'electricity',messageFamily:'PRODAT',messageCode:'Z01',businessProcess:'customer_masterdata',direction:'outbound',senderEdielId:'12345',receiverEdielId:'54321',applicationReference:'23-DDQ-PRODAT',routeProfileId:'profile',communicationRouteId:'route',customerId:'customer',customerSiteId:'site',operationId:'operation',outboundRequestId:'outbound',interchangeReference:'12345678901234',messageReference:'1',transactionReference:'FROZEN-LI',payload:{documentReference:'FROZEN-DOCUMENT'},idempotencyKey:'operation',validationStatus:'validated',renderStatus:'not_rendered',outboxStatus:'not_queued'}
const route={companyId:'company',environment:'test',route:{id:'route'},senderEdielId:'12345',receiverEdielId:'54321'} as Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
const draft:CreateEdielMessageInput={actorUserId:'actor',companyId:'company',direction:'outbound',messageStandard:'edifact',messageFamily:'PRODAT',messageCode:'Z01',messageVersion:'E2SE6A',environment:'test',rawPayload:'declared mechanical wire',intentId:'intent'}
const facilityInput={intentId:'intent',actorUserId:'actor',request:{id:'request',customer_id:'customer',customer_site_id:'site',grid_owner_id:'owner',grid_area_code:'NET',price_area:'SE3'},routeContext:route,outboundRequestId:'outbound',operationId:'operation'}
const customerInput={intentId:'intent',actorUserId:'actor',dataRequest:{id:'request',company_id:'company',customer_id:'customer',site_id:'site',metering_point_id:null,grid_owner_id:'owner'},gridOwner:null,routeContext:route,outboundRequestId:'outbound',operationId:'operation',externalReference:'STALE-CALLER-DOC',transactionReference:'STALE-CALLER-LI',messageVersion:'E2SE6A',routeProfileId:'profile'}
beforeEach(()=>{vi.clearAllMocks();io.intent.mockResolvedValue(intent);io.validate.mockReturnValue({ok:true});io.facility.mockResolvedValue({draft:{...draft}});io.customer.mockResolvedValue({...draft});io.finalize.mockResolvedValue({id:'message',company_id:'company',external_reference:'FROZEN-DOCUMENT'});io.patch.mockResolvedValue({error:null});io.actor.mockResolvedValue(undefined);io.source.mockResolvedValue({rulePackId:'pack',messageProfileId:'profile-version',profileKey:'own-profile',version:'P26A-r3',sourceHash:'a'.repeat(64),snapshot:{}})})
// This checks reference plumbing only. The declared gateway ports grant no
// legal approval, native first-effect proof or production capability.
describe('actual Z01 gateways render their loaded persisted intent references',()=>{
 it.each(['facility','customer'] as const)('forwards the same four frozen namespaces through %s on repeat preparation',async kind=>{
  for(let attempt=0;attempt<2;attempt++){
   const result=kind==='facility'?await renderAndQueueFacilityLookupZ01(facilityInput):await renderAndQueueCustomerMasterdataZ01(customerInput)
   expect(result).toMatchObject({status:'queued'})
   const call=(kind==='facility'?io.facility:io.customer).mock.calls[attempt][0]
   expect(call.wireReferences).toEqual({documentReference:'FROZEN-DOCUMENT',transactionReference:'FROZEN-LI',interchangeReference:'12345678901234',messageReference:'1'})
   if(kind==='customer'){expect(call.externalReference).toBe('FROZEN-DOCUMENT');expect(call.transactionReference).toBe('FROZEN-LI')}
  }
 })
 it.each(['facility','customer'] as const)('holds malformed persisted namespace before %s render/persist/queue',async kind=>{
  io.intent.mockResolvedValue({...intent,interchangeReference:'TOO-LONG-INTERCHANGE'})
  const result=kind==='facility'?await renderAndQueueFacilityLookupZ01(facilityInput):await renderAndQueueCustomerMasterdataZ01(customerInput)
  expect(result.status).toBe('blocked')
  expect(io.facility).not.toHaveBeenCalled();expect(io.customer).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
})

const originalRaw="UNB+UNOC:3+12345+54321+261001:0000+12345678901234++23-DDQ-PRODAT++++1'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z01+FROZEN-DOCUMENT+9+AB'LIN+1++735123456789012345:::9'RFF+LI:FROZEN-LI'UNT+5+1'UNZ+1+12345678901234'"
const original={...source(originalRaw),id:'message',company_id:'company',direction:'outbound' as const,status:'acknowledged' as const,intent_id:'intent',outbound_request_id:'outbound',source_operation_id:'operation',customer_id:'customer',site_id:'site',communication_route_id:'route',route_profile_id:'profile',grid_owner_data_request_id:'request',canonical_rule_pack_id:'pack',rule_profile_version_id:'profile-version',rule_profile_key:'own-profile',rule_profile_version:'P26A-r3',rule_pack_checksum:'a'.repeat(64),interchange_reference:'12345678901234',external_reference:'FROZEN-DOCUMENT',transaction_reference:'FROZEN-LI',aperak_status:'received_positive' as const}

describe('Z01 original replay precedes fresh date, customer and registry selection',()=>{
 it.each(['facility','customer'] as const)('returns the exact old %s outcome at a later date without render, reset or requeue',async kind=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-01T12:34:56Z'))
  try{
   io.intent.mockResolvedValue({...intent,edielMessageId:'message',validationStatus:'blocked'});io.message.mockResolvedValue(original)
   io.validate.mockReturnValue({ok:false,blockingReasons:[{code:'current_registry_changed'}]})
   const changedCurrentRoute={...route,senderEdielId:'TODAY-TRANSPORT',receiverEdielId:'TODAY-REGISTRY'}
   const result=kind==='facility'?await renderAndQueueFacilityLookupZ01({...facilityInput,routeContext:changedCurrentRoute}):await renderAndQueueCustomerMasterdataZ01({...customerInput,routeContext:changedCurrentRoute})
   expect(result.status).toBe('existing');expect(result.message).toBe(original)
   expect(result.message?.raw_payload).toBe(originalRaw);expect(result.message?.status).toBe('acknowledged');expect(result.message?.aperak_status).toBe('received_positive')
   expect(io.actor).toHaveBeenCalledWith({companyId:'company',actorUserId:'actor',permissionAnyOf:['communication.read','metering.read']})
   expect(io.message).toHaveBeenCalledWith('message',{companyId:'company'})
   expect(io.source).toHaveBeenCalledWith('company','message')
   for(const port of [io.validate,io.facility,io.customer,io.finalize,io.queue,io.link,io.patch,io.lifecycle])expect(port).not.toHaveBeenCalled()
  }finally{vi.useRealTimers()}
 })
 it('reads the genuine original alphabet during replay without a default-separator fallback',async()=>{
  const alternate=EdifactEnvelopeCodec.encode({sender:'12345',receiver:'54321',interchangeReference:'12345678901234',applicationReference:'23-DDQ-PRODAT',environment:'test',acknowledgementRequest:true,
   una:{componentDataElementSeparator:'^',dataElementSeparator:';',releaseCharacter:'!',segmentTerminator:'~'},messages:[{messageReference:'1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:['BGM+Z01+FROZEN-DOCUMENT+9+AB','LIN+1++735123456789012345:::9','RFF+LI:FROZEN-LI']}]})
  const frozen={...original,raw_payload:alternate}
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.message.mockResolvedValue(frozen)
  const result=await renderAndQueueCustomerMasterdataZ01(customerInput)
  expect(result.status,JSON.stringify(result.blockingReasons)).toBe('existing');expect(result.message).toBe(frozen);expect(result.message?.raw_payload).toBe(alternate)
  for(const port of [io.validate,io.customer,io.finalize,io.queue,io.lifecycle])expect(port).not.toHaveBeenCalled()
 })
 it.each([{company_id:'foreign'},{environment:'production'},{outbound_request_id:'other'},{source_operation_id:'other'},{customer_id:'other'},{site_id:'other'},{intent_id:'other'},{communication_route_id:'other'},{route_profile_id:'other'},{rule_profile_version_id:'other'},{raw_payload:originalRaw.replace('FROZEN-LI','OTHER')}])('holds a different immutable original binding %j before returning or writing',async changed=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.message.mockResolvedValue({...original,...changed})
  const result=await renderAndQueueCustomerMasterdataZ01(customerInput)
  expect(result.status).toBe('blocked');expect(result.message).toBeNull();expect(io.customer).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled();expect(io.lifecycle).not.toHaveBeenCalled()
 })
 it('requires current tenant read authorization before exposing a protected old original',async()=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.actor.mockRejectedValue(new Error('ediel_tenant_actor_forbidden'))
  const result=await renderAndQueueFacilityLookupZ01(facilityInput)
  expect(result.status).toBe('blocked');expect(result.message).toBeNull();expect(io.message).not.toHaveBeenCalled();expect(io.source).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
 it('holds missing actual historical receipt instead of capturing or reminting it',async()=>{
  io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.message.mockResolvedValue(original);io.source.mockRejectedValue(new Error('ediel_historical_rule_pack_basis_unavailable'))
  const result=await renderAndQueueFacilityLookupZ01(facilityInput)
  expect(result.status).toBe('blocked');expect(result.message).toBeNull();expect(io.facility).not.toHaveBeenCalled();expect(io.finalize).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
})

// These declared I/O ports prove scope and ordering only; they do not create a
// historical source receipt or approve an authentic issuer/production send.
const requestReplay={actorUserId:'actor',companyId:'company',requestId:'request',requestKind:'customer_masterdata' as const,customerId:'customer',siteId:'site',operationId:'operation',messageIds:['message']}
function outboundScope(changes:Record<string,unknown>={}){return{id:'outbound',company_id:'company',source_type:'grid_owner_data_request',source_id:'request',request_type:'customer_masterdata',customer_id:'customer',site_id:'site',operation_id:'operation',response_payload:{edielMessageId:'message'},...changes}}
describe('upstream owned Z01 request selectors are qualified before routing',()=>{
 beforeEach(()=>{
  const query={select:vi.fn(),eq:vi.fn(),limit:io.outboundRead};query.select.mockReturnValue(query);query.eq.mockReturnValue(query)
  const orphan={select:vi.fn(),eq:vi.fn(),in:vi.fn(),limit:io.orphanRead};orphan.select.mockReturnValue(orphan);orphan.eq.mockReturnValue(orphan);orphan.in.mockReturnValue(orphan);io.query.mockImplementation(table=>table==='ediel_messages'?orphan:query);io.orphanRead.mockResolvedValue({data:[],error:null})
  io.outboundRead.mockResolvedValue({data:[outboundScope()],error:null});io.intent.mockResolvedValue({...intent,edielMessageId:'message'});io.message.mockResolvedValue(original)
 })
 it('returns the exact stored message through the owned response selector with no current guide selection',async()=>{
  const result=await readZ01OriginalForRequest(requestReplay)
  expect(result?.message).toBe(original);expect(result?.outbound.id).toBe('outbound')
  expect(io.query).toHaveBeenCalledWith('outbound_requests');expect(io.source).toHaveBeenCalledWith('company','message');expect(io.validate).not.toHaveBeenCalled()
  expect(io.actor.mock.invocationCallOrder[0]).toBeLessThan(io.query.mock.invocationCallOrder[0])
 })
 it('returns null only when the own request has no established original selector',async()=>{
  io.outboundRead.mockResolvedValue({data:[outboundScope({response_payload:{}})],error:null})
  expect(await readZ01OriginalForRequest({...requestReplay,messageIds:[]})).toBeNull();expect(io.message).not.toHaveBeenCalled();expect(io.source).not.toHaveBeenCalled()
 })
 it('recovers only the exact source-bound orphan original before its public response was published',async()=>{
  io.outboundRead.mockResolvedValue({data:[outboundScope({response_payload:{}})],error:null})
  io.orphanRead.mockResolvedValue({data:[{id:'message',intent_id:'intent',outbound_request_id:'outbound',source_operation_id:'operation'}],error:null})
  const result=await readZ01OriginalForRequest({...requestReplay,messageIds:[]})
  expect(result?.message).toBe(original);expect(io.source).toHaveBeenCalledWith('company','message')
  expect(io.query).toHaveBeenCalledWith('ediel_messages');expect(io.validate).not.toHaveBeenCalled();expect(io.queue).not.toHaveBeenCalled()
 })
 it.each([{outbound_request_id:'foreign'},{source_operation_id:'foreign'},{intent_id:null}])('holds an orphan with changed own immutable scope %j',async change=>{
  io.outboundRead.mockResolvedValue({data:[outboundScope({response_payload:{}})],error:null})
  io.orphanRead.mockResolvedValue({data:[{id:'message',intent_id:'intent',outbound_request_id:'outbound',source_operation_id:'operation',...change}],error:null})
  await expect(readZ01OriginalForRequest({...requestReplay,messageIds:[]})).rejects.toThrow('z01_original_scope_changed');expect(io.source).not.toHaveBeenCalled()
 })
 it('holds multiple original candidates instead of choosing a newest orphan',async()=>{
  io.outboundRead.mockResolvedValue({data:[outboundScope({response_payload:{}})],error:null})
  io.orphanRead.mockResolvedValue({data:[{id:'message'},{id:'other'}],error:null})
  await expect(readZ01OriginalForRequest({...requestReplay,messageIds:[]})).rejects.toThrow('z01_original_source_ambiguous');expect(io.message).not.toHaveBeenCalled();expect(io.source).not.toHaveBeenCalled()
 })
 it.each([{messageIds:['message','other']},{operationId:'other'},{environment:'production' as const},{routeId:'other'},{outboundIds:['other']}])('holds incompatible caller scope %j without relabeling the original',async delta=>{
  await expect(readZ01OriginalForRequest({...requestReplay,...delta})).rejects.toThrow(/z01_original_(scope_changed|source_ambiguous)/)
 })
 it.each([{company_id:'foreign'},{customer_id:'foreign'},{site_id:'foreign'},{operation_id:'foreign'}])('holds a foreign owned outbound tuple %j',async delta=>{
  io.outboundRead.mockResolvedValue({data:[outboundScope(delta)],error:null})
  await expect(readZ01OriginalForRequest(requestReplay)).rejects.toThrow('z01_original_scope_changed');expect(io.source).not.toHaveBeenCalled()
 })
 it('requires an exact unique outbound and intent before historical evidence',async()=>{
  io.outboundRead.mockResolvedValue({data:[outboundScope(),outboundScope()],error:null})
  await expect(readZ01OriginalForRequest(requestReplay)).rejects.toThrow('z01_original_scope_changed');expect(io.source).not.toHaveBeenCalled()
 })
 it('holds a different facility request anchor while using the same stored source tuple',async()=>{
  io.intent.mockResolvedValue({...intent,businessProcess:'facility_lookup',edielMessageId:'message',gridOwnerInformationRequestId:'other'})
  io.outboundRead.mockResolvedValue({data:[outboundScope({source_type:'manual'})],error:null})
  await expect(readZ01OriginalForRequest({...requestReplay,requestKind:'facility_lookup'})).rejects.toThrow('z01_original_scope_changed')
 })
 it('denies a retired or foreign reader before any source selector query',async()=>{
  io.actor.mockRejectedValue(new Error('ediel_tenant_actor_forbidden'))
  await expect(readZ01OriginalForRequest(requestReplay)).rejects.toThrow('ediel_tenant_actor_forbidden');expect(io.query).not.toHaveBeenCalled();expect(io.message).not.toHaveBeenCalled()
 })
})
