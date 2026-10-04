import {beforeEach,describe,expect,it,vi} from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
import {readRegistryRouteSource,requireRegistryDispatchSource,verifyElRegistryActor} from '@/lib/actor-registry/registryMarketSource'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const scope={companyId:id(1),communicationRouteId:id(2),routeProfileId:id(3),environment:'production' as const,messageFamily:'PRODAT',applicationReference:'SOURCE-APP'}
// Explicit native source read boundary fixture only. These rows do not assert
// authentic registry provenance, approval, readiness or production activation.
const source=()=>({status:'source_qualified',routeId:id(4),actorId:id(5),market:'EL',sourceSha256:'a'.repeat(64),sourceRecordSha256:'b'.repeat(64),countryCode:'SE',legalEdielId:'LEGAL-ACTOR',roles:['grid_owner'],wire:{actorId:id(5),market:'EL',family:'PRODAT',environment:'production',subaddress:null,applicationReference:'SOURCE-APP',address:'source@example.invalid',transport:'smtp',partyId:'LEGAL-ACTOR',interchangePartyId:'TECHNICAL-AGENT'}})
describe('actual typed registry market/source dispatch contract',()=>{
 beforeEach(()=>rpc.mockReset())
 it('keeps sourced legal party separate from technical transport party',async()=>{
  rpc.mockResolvedValue({data:source(),error:null})
  const result=await readRegistryRouteSource(id(4))
  expect(result).toMatchObject({legalEdielId:'LEGAL-ACTOR',wire:{interchangePartyId:'TECHNICAL-AGENT'}})
 })
 it('requires the actual native owned dispatch before the matching current route source',async()=>{
  rpc.mockImplementation(async(name:string)=>({data:name==='ediel_registry_dispatch_source_v1'?{...source(),...scope,selectedApplicationReference:scope.applicationReference}:source(),error:null}))
  const result=await requireRegistryDispatchSource(scope)
  expect(result.legalEdielId).toBe('LEGAL-ACTOR')
  expect(rpc.mock.calls.map(call=>call[0])).toEqual(['ediel_registry_dispatch_source_v1','ediel_registry_route_source_v1'])
  expect(rpc.mock.calls[0][1]).toEqual({p_company_id:id(1),p_communication_route_id:id(2),p_route_profile_id:id(3),p_environment:'production',p_message_family:'PRODAT',p_application_reference:'SOURCE-APP'})
 })
 it.each(['companyId','communicationRouteId','routeProfileId'])('holds foreign dispatch %s',async(key)=>{
  rpc.mockImplementation(async(name:string)=>({data:name==='ediel_registry_dispatch_source_v1'?{...source(),...scope,selectedApplicationReference:scope.applicationReference,[key]:id(99)}:source(),error:null}))
  await expect(requireRegistryDispatchSource(scope)).rejects.toThrow('dispatch_result_invalid')
 })
 it('holds unmapped/historical route rather than deriving legal party from UNB',async()=>{
  rpc.mockResolvedValue({data:null,error:null})
  await expect(requireRegistryDispatchSource(scope)).rejects.toThrow('current_el_dispatch_source_required')
  expect(rpc).toHaveBeenCalledOnce()
 })
 it('holds changed private source between dispatch and subsequent route read',async()=>{
  rpc.mockImplementation(async(name:string)=>({data:name==='ediel_registry_dispatch_source_v1'?{...source(),...scope,selectedApplicationReference:scope.applicationReference}:{...source(),sourceSha256:'c'.repeat(64)},error:null}))
  await expect(requireRegistryDispatchSource(scope)).rejects.toThrow('dispatch_result_invalid')
 })
 it('does not substitute technical identity for missing legal identity',async()=>{
  rpc.mockResolvedValue({data:{...source(),legalEdielId:'TECHNICAL-AGENT'},error:null})
  await expect(readRegistryRouteSource(id(4))).rejects.toThrow('source_result_invalid')
 })
 it('preserves native source failure without source/market fallback',async()=>{
  rpc.mockResolvedValue({data:null,error:{message:'ediel_registry_route_dispatch_source_mismatch'}})
  await expect(requireRegistryDispatchSource(scope)).rejects.toMatchObject({message:'ediel_registry_route_dispatch_source_mismatch'})
  expect(rpc).toHaveBeenCalledOnce()
 })
 it('manual verifier carries actual actor/current route and keeps automatic send held',async()=>{
  rpc.mockResolvedValue({data:{actorId:id(5),routeIds:[id(4)],market:'EL',autoSendAllowed:false},error:null})
  await expect(verifyElRegistryActor({actorUserId:id(9),actorId:id(5),routeId:id(4)})).resolves.toMatchObject({routeIds:[id(4)],autoSendAllowed:false})
  expect(rpc.mock.calls[0][1]).toEqual({p_actor_user_id:id(9),p_actor_id:id(5),p_route_id:id(4)})
 })
 it('qualifies the explicit AI_LIST alias without conflating legal and transport parties',async()=>{
  const ai={...source(),legalName:'Immutable legal network',wire:{...source().wire,family:'AI',applicationReference:null}}
  const selected={...scope,messageFamily:'AI_LIST',applicationReference:null}
  rpc.mockImplementation(async(name:string)=>({data:name==='ediel_registry_dispatch_source_v1'?{...ai,...selected,canonicalFamily:'AI',selectedApplicationReference:null}:ai,error:null}))
  expect(await requireRegistryDispatchSource(selected)).toMatchObject({canonicalFamily:'AI',legalName:'Immutable legal network',legalEdielId:'LEGAL-ACTOR',wire:{family:'AI',interchangePartyId:'TECHNICAL-AGENT'}})
 })
 it('does not pass an AI EDIFACT application to the native source owner',async()=>{
  await expect(requireRegistryDispatchSource({...scope,messageFamily:'AI_LIST'})).rejects.toThrow('ai_list_application_forbidden');expect(rpc).not.toHaveBeenCalled()
 })
 it.each(['canonicalFamily','legalName'])('holds missing actual AI source field %s',async(key)=>{
  const ai={...source(),legalName:'Immutable legal network',wire:{...source().wire,family:'AI',applicationReference:null}}
  const selected={...scope,messageFamily:'AI_LIST',applicationReference:null}
  rpc.mockImplementation(async(name:string)=>({data:name==='ediel_registry_dispatch_source_v1'?{...ai,...selected,canonicalFamily:'AI',selectedApplicationReference:null,[key]:undefined}:ai,error:null}))
  await expect(requireRegistryDispatchSource(selected)).rejects.toThrow('dispatch_result_invalid')
 })
})
