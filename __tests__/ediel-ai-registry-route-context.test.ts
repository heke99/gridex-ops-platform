// masterplan: ENV-05, AT-ENV-05
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {resolveCanonicalRouteContext,assertFreshBusinessRegistryRouteSource} from '@/lib/ediel/core/routeRegistry'
import {materializeCompanyGridOwnerRoute,materializePlatformActorRoute} from '@/lib/ediel/routeMaterializer'

// Actual context/materializer/policy code; IO models only current own tenant,
// actor/profile and protected registry source ports. No authentic authority,
// network mandate, readiness or activation is asserted by these fixtures.
const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),actor:vi.fn(),runtime:vi.fn(),sender:vi.fn(),source:vi.fn(),readiness:vi.fn(),profileReadiness:vi.fn(),writes:[] as {table:string;payload:Record<string,unknown>}[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
vi.mock('@/lib/cis/db-routes',()=>({findBestCommunicationRoute:vi.fn()}))
vi.mock('@/lib/ediel/config',()=>({getEdielRouteRuntimeByCommunicationRouteId:io.runtime}))
vi.mock('@/lib/ediel/core/actorRegistry',()=>({resolveCanonicalActorContext:io.actor}))
vi.mock('@/lib/ediel/senderSettingsResolver',()=>({resolveSenderSettings:io.sender,senderSettingProductionLockStatus:()=> 'locked'}))
vi.mock('@/lib/ediel/companyRouteReadiness',()=>({getCompanyGridOwnerRouteReadiness:io.readiness}))
vi.mock('@/lib/ediel/routeProfileProductionReadiness',()=>({evaluateRouteProfileProductionReadiness:io.profileReadiness}))
vi.mock('@/lib/actor-registry/registryMarketSource',async original=>({...await original<Record<string,unknown>>(),requireElRegistryRouteSource:io.source}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const company=id(1),routeId=id(2),profileId=id(3),registryId=id(4),actorId=id(5),gridId=id(6)
const route=()=>({id:routeId,company_id:company,is_active:true,route_name:'Explicit synthetic AI route',target_system:'counterparty',environment_type:'production',target_email:'ai@example.invalid'})
const runtime=()=>({company_id:company,route_profile_id:profileId,communication_route_id:routeId,environment:'production',message_family:'AI_LIST',message_standard:'ai_list',payload_format:'raw',ack_mode:'none',is_enabled:true,receiver_ediel_id:'NETWORK-TRANSPORT',receiver_subaddress:null,receiver_sub_address:null,application_reference:null,default_message_version:'Ver20140401'})
const platform=()=>({id:registryId,actor_id:actorId,message_family:'AI',application_reference:null,environment:'production',subaddress:null,communication_type:'smtp',communication_address:'ai@example.invalid',party_id:'NETWORK-LEGAL',interchange_party_id:'NETWORK-TRANSPORT',is_verified:true,auto_send_allowed:true,status:'active',metadata:{}})
const source=()=>({status:'source_qualified',routeId:registryId,actorId,market:'EL',sourceSha256:'a'.repeat(64),sourceRecordSha256:'b'.repeat(64),countryCode:'SE',legalEdielId:'NETWORK-LEGAL',legalName:'Immutable legal network',roles:['grid_owner'],wire:{actorId,market:'EL',family:'AI',environment:'production',subaddress:null,applicationReference:null,address:'ai@example.invalid',transport:'smtp',partyId:'NETWORK-LEGAL',interchangePartyId:'NETWORK-TRANSPORT'}})
beforeEach(()=>{
 vi.clearAllMocks();io.writes=[]
 io.actor.mockResolvedValue({senderEdielId:'SUPPLIER-TRANSPORT',senderName:'Current technical label',senderSubAddress:null,mailbox:'own@example.invalid',defaultApplicationReference:'23-DDQ-PRODAT'})
 io.runtime.mockResolvedValue(runtime());io.source.mockResolvedValue(source())
 io.sender.mockResolvedValue({status:'resolved',setting:{id:id(7),company_id:company,environment:'production',ediel_id:'SUPPLIER-TRANSPORT',default_application_reference:'23-DDQ-PRODAT'}})
 io.readiness.mockResolvedValue({operational_route_ready:true,communication_route_id:routeId,ediel_route_profile_id:profileId,company_market_party_route_id:id(8),platform_actor_route_id:registryId,environment:'production'})
 io.rpc.mockImplementation(async(name:string)=>({data:name==='ediel_registry_dispatch_source_v1'?{...source(),companyId:company,communicationRouteId:routeId,routeProfileId:profileId,canonicalFamily:'AI',selectedApplicationReference:null}:source(),error:null}))
 io.from.mockImplementation((table:string)=>{
  let writing=false
  const query:Record<string,unknown>={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),not:vi.fn().mockReturnThis(),limit:vi.fn().mockResolvedValue({data:table==='grid_owners'?[{id:gridId,company_id:company,name:'Local route label',platform_market_actor_id:actorId}]:[],error:null}),
   maybeSingle:vi.fn().mockResolvedValue({data:table==='platform_actor_routes'?platform():table==='grid_owners'?{id:gridId,company_id:company,name:'Local route label',platform_market_actor_id:actorId}:route(),error:null}),
   insert:vi.fn().mockImplementation(payload=>{writing=true;io.writes.push({table,payload});return query}),update:vi.fn().mockImplementation(payload=>{writing=true;io.writes.push({table,payload});return query}),
   single:vi.fn().mockImplementation(async()=>({data:{id:table==='communication_routes'?routeId:table==='ediel_route_profiles'?profileId:id(8)},error:null})),
   then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data:writing?[]:table==='grid_owners'?[{id:gridId,company_id:company,name:'Local route label',platform_market_actor_id:actorId}]:[],error:null}).then(resolve)}
  return query
 })
})

describe('actual AI technical route protocol projection',()=>{
 const input={requestType:'meter_values' as const,preferredRouteId:routeId,companyId:company,environment:'production' as const,messageStandard:'ai_list' as const}
 it('does not select a production communication route for a test actor',async()=>{
  await expect(resolveCanonicalRouteContext({...input,environment:'test'})).rejects.toThrow('canonical_route_environment_mismatch')
  expect(io.actor).toHaveBeenCalledWith('test',company,null)
  expect(io.runtime).not.toHaveBeenCalled()
 })
 it.each(['tgt_test','agt_test','bilateral_test'])('does not select a %s communication route for production',async environment_type=>{
  io.from.mockImplementation(()=>({select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{...route(),environment_type},error:null})}))
  await expect(resolveCanonicalRouteContext(input)).rejects.toThrow('canonical_route_environment_mismatch')
  expect(io.runtime).not.toHaveBeenCalled()
 })
 it('holds a profile of the other environment even when the communication route matches',async()=>{
  io.runtime.mockResolvedValue({...runtime(),environment:'test'})
  await expect(resolveCanonicalRouteContext(input)).rejects.toThrow('canonical_route_profile_environment_mismatch')
  expect(io.writes).toEqual([])
 })
 it('keeps absent AI APP despite the own actor PRODAT default',async()=>{
  const context=await resolveCanonicalRouteContext(input)
  expect(context).toMatchObject({applicationReference:null,messageStandard:'ai_list',senderEdielId:'SUPPLIER-TRANSPORT',receiverEdielId:'NETWORK-TRANSPORT'})
  expect(io.rpc).not.toHaveBeenCalled()
  await assertFreshBusinessRegistryRouteSource(context,'AI_LIST')
  expect(io.rpc.mock.calls[0][1]).toMatchObject({p_message_family:'AI_LIST',p_application_reference:null})
 })
 it.each(['caller','profile'])('rejects declared AI APP from %s',async where=>{
  if(where==='profile')io.runtime.mockResolvedValue({...runtime(),application_reference:'23-DDQ-PRODAT'})
  await expect(resolveCanonicalRouteContext({...input,...(where==='caller'?{applicationReference:'23-DDQ-PRODAT'}:{})})).rejects.toThrow('ai_list_application_reference_forbidden')
 })
 it.each([{message_family:'PRODAT'},{message_standard:'edifact'},{is_enabled:false}])('requires the actual enabled AI profile %s',async changed=>{
  io.runtime.mockResolvedValue({...runtime(),...changed})
  await expect(resolveCanonicalRouteContext(input)).rejects.toThrow('ai_list_actual_route_profile_required')
 })
 it('preserves production portal recipient fencing for AI',async()=>{
  io.from.mockImplementation(()=>({select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{...route(),target_email:'portal@ediel.se'},error:null})}))
  await expect(resolveCanonicalRouteContext(input)).rejects.toThrow('Produktionsruntime får inte använda Edielportalens TGT-route')
 })
 it.each(['company','platform'])('materializes explicit source AI through actual %s consumer',async consumer=>{
  if(consumer==='company')await materializeCompanyGridOwnerRoute({companyId:company,gridOwnerId:gridId,platformActorRouteId:registryId,actorUserId:id(9)})
  else await materializePlatformActorRoute({platformActorRouteId:registryId,actorUserId:id(9)})
  expect(io.writes.find(row=>row.table==='ediel_route_profiles')?.payload).toMatchObject({message_family:'AI_LIST',message_code:'AI',message_standard:'ai_list',payload_format:'raw',application_reference:null,ack_mode:'none',receiver_ediel_id:'NETWORK-TRANSPORT',default_message_version:'Ver20140401'})
  expect(io.writes.find(row=>row.table==='communication_routes')?.payload.supported_message_families).toEqual(['AI_LIST'])
  expect(io.profileReadiness.mock.calls.every(call=>call[0].approveProduction===false)).toBe(true)
 })
 it('blocks an AI source declaring an EDIFACT APP before operational writes',async()=>{
  io.source.mockResolvedValue({...source(),wire:{...source().wire,applicationReference:'UNSUPPORTED'}})
  await expect(materializeCompanyGridOwnerRoute({companyId:company,gridOwnerId:gridId,platformActorRouteId:registryId})).rejects.toThrow('materialization_scope_mismatch');expect(io.writes).toEqual([])
 })
 it('platform bulk path also rejects AI APP before any operational write',async()=>{
  io.source.mockResolvedValue({...source(),wire:{...source().wire,applicationReference:'UNSUPPORTED'}})
  await expect(materializePlatformActorRoute({platformActorRouteId:registryId})).rejects.toThrow('materialization_scope_mismatch');expect(io.writes).toEqual([])
 })
 it('does not materialize an unrelated code on the AI protocol',async()=>{
  await expect(materializeCompanyGridOwnerRoute({companyId:company,gridOwnerId:gridId,platformActorRouteId:registryId,messageCode:'Z01'})).rejects.toThrow('ai_list_message_code_required');expect(io.writes).toEqual([])
 })
})
