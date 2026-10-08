// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO
// Finite consumer proof only. Query IO models configured profiles; this does
// not qualify a native source, ACK witness, whole contract or market activation.
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {getEdielRouteRuntimeByCommunicationRouteId} from '@/lib/ediel/config'
import {resolveCanonicalOutboundContext} from '@/lib/ediel/core/kernelLegacy'

const io=vi.hoisted(()=>({profiles:[] as Record<string,unknown>[],views:[] as Record<string,unknown>[],
 reads:[] as string[],actor:vi.fn(),route:vi.fn(),override:null as Record<string,unknown>|null}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 io.reads.push(table)
 const filters:((row:Record<string,unknown>)=>boolean)[]=[]
 const query={select:()=>query,eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return query},
  or:(expression:string)=>{const [absent,equal]=expression.split(',');const key=absent.split('.')[0]
   const value=equal.split('.eq.')[1];filters.push(row=>row[key]===null||row[key]===value);return query},
  maybeSingle:async()=>{const rows=(table==='ediel_route_profiles'?io.profiles:io.views).filter(row=>filters.every(f=>f(row)))
   if(rows.length>1)return {data:null,error:{code:'PGRST116',message:'Multiple rows cannot be returned as one JSON object'}}
   return {data:table==='ediel_route_runtime_v'&&rows[0]&&io.override?{...rows[0],...io.override}:rows[0]??null,error:null}}}
 return query
}}}))
vi.mock('@/lib/ediel/core/actorRegistry',()=>({resolveCanonicalActorContext:io.actor}))
vi.mock('@/lib/cis/db-routes',()=>({findBestCommunicationRoute:io.route}))

const company='00000000-0000-4000-8000-000000000001',route='00000000-0000-4000-8000-000000000002'
const app='23-DGI-PRODAT'
const selection=()=>({companyId:company,ackProfile:{family:'APERAK' as const,code:'APERAK',environment:'test' as const,applicationReference:app}})
function profile(id:string,family:string|null='APERAK',applicationReference=app,code:string|null='APERAK'){
 return {id,company_id:company,communication_route_id:route,environment:'test',message_family:family,
  business_code:code,application_reference:applicationReference,is_active:true,is_enabled:true}
}
function view(row:Record<string,unknown>){return {...row,route_profile_id:row.id,message_standard:'edifact',payload_format:'edifact',
 communication_route_active:true,route_name:'Synthetic ACK route',route_scope:'ediel_ack',route_type:'smtp',
 target_system:'counterparty',target_email:'synthetic@example.invalid',receiver_ediel_id:'COUNTERPART',sender_ediel_id:'OWN',
 ack_mode:'default',mailbox:'synthetic@example.invalid',default_message_version:null}}
function configure(rows:Record<string,unknown>[]){io.profiles=rows;io.views=rows.map(view)}
beforeEach(()=>{vi.clearAllMocks();io.reads=[];io.override=null
 configure([profile('old-e66',null,'23-DGI-E66-T',null),profile('contrl','CONTRL',app,'CONTRL'),profile('aperak')])
 io.actor.mockResolvedValue({senderEdielId:'OWN',senderName:'Synthetic',senderSubAddress:null,mailbox:'synthetic@example.invalid',defaultApplicationReference:app})
 io.route.mockResolvedValue({id:route,company_id:company,is_active:true,route_name:'Synthetic',route_scope:'ediel_ack',environment_type:'bilateral_test',target_email:'synthetic@example.invalid'})
})

describe('fresh ACK profiles use the source-qualified unique configuration',()=>{
 it('keeps the original unqualified three-profile ambiguity visible',async()=>{
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,{companyId:company})).rejects.toMatchObject({code:'PGRST116'})
 })
 it('selects only actual source-APP APERAK among retained E66 and CONTRL',async()=>{
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,selection())).resolves.toMatchObject({route_profile_id:'aperak',application_reference:app,message_family:'APERAK'})
  expect(io.reads).toContain('ediel_route_profiles')
 })
 it('passes the exact ACK context through the public outbound wrapper and registry',async()=>{
  const params={requestType:'ediel_ack' as const,companyId:company,environment:'test' as const,applicationReference:app,
   ackProfile:{family:'APERAK' as const,code:'APERAK'}}
  await expect(resolveCanonicalOutboundContext(params)).resolves.toMatchObject({routeRuntime:{route_profile_id:'aperak'},applicationReference:app})
 })
 it('does not reinterpret explicit NULL or business-route ACK context as a legacy call',async()=>{
  for(const params of [{requestType:'ediel_ack',ackProfile:null},
   {requestType:'metering_access',ackProfile:{family:'APERAK',code:'APERAK'}}]){
   await expect(resolveCanonicalOutboundContext({...params,companyId:company,environment:'test',applicationReference:app} as never))
    .rejects.toThrow('ediel_ack_route_profile_basis_required')
  }
  expect(io.reads).toEqual([])
 })
 for(const [label,delta] of Object.entries({tenant:{company_id:'foreign'},route:{communication_route_id:'foreign'},
  environment:{environment:'production'},APP:{application_reference:'23-DGI-E66-T'},family:{message_family:'CONTRL'},
  code:{business_code:'CONTRL'},inactive:{is_active:false},disabled:{is_enabled:false}})){
  it('refuses only '+label+'-incompatible candidates without fallback',async()=>{
   configure([{...profile('wrong'),...delta}])
   await expect(getEdielRouteRuntimeByCommunicationRouteId(route,selection())).rejects.toThrow('ediel_ack_route_profile_required')
   expect(io.reads).not.toContain('ediel_route_runtime_v')
  })
 }
 it('refuses absence without an unfiltered view fallback',async()=>{
  configure([]);await expect(getEdielRouteRuntimeByCommunicationRouteId(route,selection())).rejects.toThrow('ediel_ack_route_profile_required')
  expect(io.reads).not.toContain('ediel_route_runtime_v')
 })
 it.each([['specific',profile('second')],['wildcard',profile('generic',null,app,null)]])('refuses a competing %s profile',async(_label,second)=>{
  configure([profile('first'),second]);await expect(getEdielRouteRuntimeByCommunicationRouteId(route,selection())).rejects.toMatchObject({code:'PGRST116'})
  expect(io.reads).not.toContain('ediel_route_runtime_v')
 })
 it('accepts a unique compatible NULL family/code without discarding its identity',async()=>{
  configure([profile('generic',null,app,null)])
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,selection())).resolves.toMatchObject({route_profile_id:'generic'})
 })
 for(const [label,delta] of Object.entries({profile:{route_profile_id:'other'},tenant:{company_id:'other'},route:{communication_route_id:'other'},
  environment:{environment:'production'},APP:{application_reference:'23-DGI-E66-T'},family:{message_family:'CONTRL'},code:{business_code:'CONTRL'},disabled:{is_enabled:false}})){
  it('refuses a returned runtime '+label+' mismatch',async()=>{
   configure([profile('aperak')]);io.override=delta
   await expect(getEdielRouteRuntimeByCommunicationRouteId(route,selection())).rejects.toThrow('ediel_ack_route_profile_scope_mismatch')
  })
 }
 it('refuses a missing exact-profile runtime view',async()=>{
  configure([profile('aperak')]);io.views=[]
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,selection())).rejects.toThrow('ediel_ack_route_profile_scope_mismatch')
 })
 it('retains the ordinary single-profile path without an ACK candidate query',async()=>{
  configure([profile('ordinary',null,'23-DGI-E66-T',null)])
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,{companyId:company})).resolves.toMatchObject({route_profile_id:'ordinary'})
  expect(io.reads).toEqual(['ediel_route_runtime_v'])
 })
 it('refuses incomplete or unsafe ACK query context before any profile read',async()=>{
  for(const context of [{...selection(),companyId:null},
   {...selection(),ackProfile:null},
   {...selection(),ackProfile:{...selection().ackProfile,applicationReference:''}},
   {...selection(),ackProfile:{...selection().ackProfile,code:'APERAK),is_active.eq.false'}},
   {...selection(),ackProfile:{...selection().ackProfile,family:'UNKNOWN'}},
   {...selection(),ackProfile:{...selection().ackProfile,environment:'other'}}]){
   await expect(getEdielRouteRuntimeByCommunicationRouteId(route,context as never)).rejects.toThrow('ediel_ack_route_profile_basis_required')
  }
  expect(io.reads).toEqual([])
 })
})
