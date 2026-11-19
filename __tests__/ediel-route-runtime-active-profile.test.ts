// Sim finding 024: unselected route runtime lookup must resolve the single
// active profile instead of failing with PGRST116 on retained inactive rows.
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {getEdielRouteRuntimeByCommunicationRouteId} from '@/lib/ediel/config'
import {evaluateEdielRouteContract} from '@/lib/ediel/outbox/routeContract'
import {getAutomaticAckPolicy} from '@/lib/ediel/core/ackPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'

type Row=Record<string,unknown>
const io=vi.hoisted(()=>({profiles:[] as Row[],reads:[] as string[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 io.reads.push(table)
 const filters:((row:Row)=>boolean)[]=[]
 const rows=()=>{
  const source=table==='ediel_route_profiles'?io.profiles:io.profiles.map(view)
  return source.filter(row=>filters.every(f=>f(row)))
 }
 const query={select:()=>query,eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return query},
  or:(expression:string)=>{const [absent,equal]=expression.split(',');const key=absent.split('.')[0]
   const literal=equal.split('.eq.')[1],value=literal==='true'?true:literal==='false'?false:literal
   filters.push(row=>row[key]===null||row[key]===value);return query},
  maybeSingle:async()=>{const found=rows()
   if(found.length>1)return {data:null,error:{code:'PGRST116',message:'Multiple rows cannot be returned as one JSON object'}}
   return {data:found[0]??null,error:null}},
  then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>
   Promise.resolve({data:rows(),error:null}).then(resolve,reject)}
 return query
}}}))

const company='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000009'
const route='00000000-0000-4000-8000-000000000002',app='23-DGI-PRODAT'
function profile(id:string,isActive:boolean|null,extra:Row={}):Row{
 return {id,company_id:company,communication_route_id:route,environment:'test',message_family:null,business_code:null,
  application_reference:app,is_active:isActive,is_enabled:true,...extra}
}
// The runtime view does not expose is_active (only rp.is_enabled).
function view(row:Row):Row{const {is_active:_omit,...rest}=row;void _omit
 return {...rest,route_profile_id:row.id,communication_route_active:true,receiver_ediel_id:'COUNTERPART',
  target_email:'synthetic@example.invalid',ack_mode:'default'}}
beforeEach(()=>{io.reads=[];io.profiles=[]})

describe('unselected route runtime resolves the active profile',()=>{
 it('selects the single active profile among four inactive ones',async()=>{
  io.profiles=[profile('old-1',false),profile('old-2',false),profile('live',true),profile('old-3',false),profile('old-4',false)]
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,{companyId:company}))
   .resolves.toMatchObject({route_profile_id:'live',company_id:company,communication_route_id:route})
 })
 it('refuses two active profiles with a controlled ambiguity code',async()=>{
  io.profiles=[profile('a',true),profile('b',true),profile('old',false)]
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,{companyId:company}))
   .rejects.toMatchObject({code:'ediel_route_profile_ambiguous',message:'ediel_route_profile_ambiguous'})
 })
 it('never falls back to an inactive profile when none is active',async()=>{
  io.profiles=[profile('old-1',false),profile('old-2',false)]
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,{companyId:company}))
   .rejects.toMatchObject({code:'ediel_route_profile_inactive',message:'ediel_route_profile_inactive'})
 })
 it('treats legacy NULL activity as active, like the ACK selection path',async()=>{
  io.profiles=[profile('legacy',null),profile('old',false)]
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,{companyId:company}))
   .resolves.toMatchObject({route_profile_id:'legacy'})
 })
 it('keeps the single active profile result, verified by a scoped profile read',async()=>{
  io.profiles=[profile('only',true)]
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,{companyId:company}))
   .resolves.toMatchObject({route_profile_id:'only'})
  expect(io.reads).toEqual(['ediel_route_runtime_v','ediel_route_profiles'])
 })
 it('refuses a single inactive profile and returns no runtime to send through',async()=>{
  io.profiles=[profile('only-old',false)]
  const result=getEdielRouteRuntimeByCommunicationRouteId(route,{companyId:company})
  await expect(result).rejects.toMatchObject({code:'ediel_route_profile_inactive',message:'ediel_route_profile_inactive'})
  expect(io.reads).toEqual(['ediel_route_runtime_v','ediel_route_profiles'])
 })
 it('keeps the ACK selection path unchanged',async()=>{
  io.profiles=[profile('aperak',true,{message_family:'APERAK',business_code:'APERAK'}),profile('old',false)]
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,{companyId:company,
   ackProfile:{family:'APERAK',code:'APERAK',environment:'test',applicationReference:app}}))
   .resolves.toMatchObject({route_profile_id:'aperak'})
  expect(io.reads).toEqual(['ediel_route_profiles','ediel_route_runtime_v'])
 })
 it('ignores another tenant\'s active profile on the same route id',async()=>{
  io.profiles=[profile('mine',true),profile('old',false),profile('foreign',true,{company_id:other})]
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,{companyId:company}))
   .resolves.toMatchObject({route_profile_id:'mine',company_id:company})
  io.profiles=[profile('old',false),profile('old-2',false),profile('foreign',true,{company_id:other})]
  await expect(getEdielRouteRuntimeByCommunicationRouteId(route,{companyId:company}))
   .rejects.toMatchObject({code:'ediel_route_profile_inactive'})
 })
})

describe('route contract and ACK policy handle profile configuration errors',()=>{
 const outbound=()=>({id:'m1',company_id:company,communication_route_id:route,direction:'outbound',environment:'test',
  message_family:'UTILTS',message_code:'E66',receiver_ediel_id:'COUNTERPART'}) as unknown as EdielMessageRow
 it('blocks two active profiles with ediel_route_profile_ambiguous before any send-side read',async()=>{
  io.profiles=[profile('a',true),profile('b',true)]
  await expect(evaluateEdielRouteContract(outbound())).resolves.toMatchObject({ok:false,blocker:'ediel_route_profile_ambiguous',routeId:route})
  expect(io.reads).toEqual(['ediel_route_runtime_v','ediel_route_profiles'])
 })
 it('blocks a single inactive profile with ediel_route_profile_inactive',async()=>{
  io.profiles=[profile('old',false)]
  await expect(evaluateEdielRouteContract(outbound())).resolves.toMatchObject({ok:false,blocker:'ediel_route_profile_inactive'})
 })
 it('blocks an active but disabled profile as route_not_active',async()=>{
  io.profiles=[profile('off',true,{is_enabled:false})]
  await expect(evaluateEdielRouteContract(outbound())).resolves.toMatchObject({ok:false,blocker:'route_not_active'})
 })
 const inbound=(companyId:string|null)=>({id:'s1',company_id:companyId,communication_route_id:route,direction:'inbound',
  message_standard:'edifact',message_family:'UTILTS',message_code:'E66',environment:'test',
  application_reference:'23-DGI-E66-T',raw_payload:"UNB+UNOC:3+SENDER:14+RECEIVER:14+261030:1000+REF++23-DGI-E66-T'UNH+M+UTILTS:D:02B:UN:E5SE5A'BGM+E66+DOC+9'IDE+24+IDE-A'LOC+172+POINT-A:::9'UNT+5+M'UNZ+1+REF'",
  created_at:'2026-10-30T10:00:00.000Z',message_received_at:'2026-10-30T10:00:00.000Z'}) as unknown as EdielMessageRow
 it('ACK policy uses the tenant-scoped lookup and default ack mode for inactive/ambiguous profiles',async()=>{
  io.profiles=[profile('a',true),profile('b',true),profile('foreign',true,{company_id:other})]
  const ambiguous=await getAutomaticAckPolicy(inbound(company))
  expect(io.reads.slice(0,2)).toEqual(['ediel_route_runtime_v','ediel_route_profiles'])
  io.reads=[];io.profiles=[profile('old',false)]
  await expect(getAutomaticAckPolicy(inbound(company))).resolves.toEqual(ambiguous)
  expect(ambiguous.ackDueAt).not.toBeNull()
 })
 it('ACK policy without company scope keeps the legacy single view read (no cross-tenant profile reads)',async()=>{
  io.profiles=[profile('only',true)]
  await getAutomaticAckPolicy(inbound(null))
  expect(io.reads[0]).toBe('ediel_route_runtime_v')
  expect(io.reads).not.toContain('ediel_route_profiles')
 })
})
