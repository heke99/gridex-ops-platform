import {beforeEach,expect,it,vi} from 'vitest'
import {raw,line,qty,common,characteristic,type Parts} from './fixtures/prodat-register'
import {source,head} from './fixtures/prodat-identity'
import type {EdielMessageRow} from '@/lib/ediel/types'

// The message writer, ACK builder, canonical ACK gateway and outbox helper are
// real. Only the external database transport and unrelated business adapters
// are replaced; the native companion verifies the SQL constraints.
const state=vi.hoisted(()=>({source:null as EdielMessageRow|null,messages:[] as Record<string,unknown>[],outbox:[] as Record<string,unknown>[],events:[] as Record<string,unknown>[],effects:[] as string[],routeAvailable:true}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 if(table==='ediel_messages')return {insert(row:Record<string,unknown>){return {select(){return {single:async()=>{const saved={...row,id:`00000000-0000-4000-8000-${String(state.messages.length+100).padStart(12,'0')}`};state.messages.push(saved);return {data:saved,error:null}}}}}},
   select(){const conditions:Record<string,unknown>={};return {eq(k:string,v:unknown){conditions[k]=v;return this},maybeSingle:async()=>({data:state.messages.find(item=>Object.entries(conditions).every(([k,v])=>item[k]===v))??null,error:null})}}}
 if(table==='ediel_message_events')return {insert(row:Record<string,unknown>){return {select(){return {single:async()=>{state.events.push(row);return {data:row,error:null}}}}}}}
 if(table==='ediel_outbox')return {
   upsert(row:Record<string,unknown>,options:{ignoreDuplicates?:boolean}){return {select(){return {maybeSingle:async()=>{const old=state.outbox.find(item=>item.lock_key===row.lock_key);if(old&&options.ignoreDuplicates)return {data:null,error:null};const saved={...row,id:`00000000-0000-4000-8000-${String(state.outbox.length+200).padStart(12,'0')}`};state.outbox.push(saved);return {data:saved,error:null}}}}}},
   select(){const conditions:Record<string,unknown>={};return {eq(k:string,v:unknown){conditions[k]=v;return this},maybeSingle:async()=>({data:state.outbox.find(item=>Object.entries(conditions).every(([k,v])=>item[k]===v))??null,error:null})}},
   update(patch:Record<string,unknown>){const conditions:Record<string,unknown>={};let allowed:string[]=[];return {eq(k:string,v:unknown){conditions[k]=v;return this},in(_k:string,v:string[]){allowed=v;return this},select(){return {maybeSingle:async()=>{const old=state.outbox.find(item=>Object.entries(conditions).every(([k,v])=>item[k]===v)&&allowed.includes(String(item.status)));if(!old)return {data:null,error:null};Object.assign(old,patch);return {data:old,error:null}}}}}},
 }
 throw Error(`unexpected external table ${table}`)
}}}))
vi.mock('@/lib/ediel/db',async original=>{
 const actual=await original<typeof import('@/lib/ediel/db')>()
 return {...actual,getEdielMessageById:async(id:string)=>id===state.source?.id?state.source:state.messages.find(row=>row.id===id)??null,
  updateEdielMessageStatus:async(p:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{state.source={...state.source!,status:p.status,parsed_payload:p.parsedPayload??{},validation_report:p.validationReport??{}} as EdielMessageRow;return state.source},
  createEdielMessageEvent:async(event:Record<string,unknown>)=>{state.events.push(event);return null},linkEdielMessage:async()=>{state.effects.push('link')},
  listAckMessagesForSource:async({sourceMessageId,ackFamily}:{sourceMessageId:string;ackFamily?:string})=>state.messages.filter(row=>row.related_message_id===sourceMessageId&&(!ackFamily||row.message_family===ackFamily)),
  getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[]}
})
vi.mock('@/lib/ediel/core/kernelLegacy',async original=>({...await original<Record<string,unknown>>(),resolveCanonicalOutboundContext:async({companyId,environment}:{companyId:string;environment:string})=>{if(!state.routeAvailable)throw Error('no qualified ACK route');return {route:{id:'00000000-0000-4000-8000-000000000030',company_id:companyId,route_name:'synthetic ACK route'},routeRuntime:{route_profile_id:'00000000-0000-4000-8000-000000000031',environment},environment}}}))
vi.mock('@/lib/ediel/rulebook/validator',async original=>({...await original<Record<string,unknown>>(),validateRulebookMessageWithRegistry:async()=>({issues:[],fieldRuleSource:'registry',rulePackSnapshot:{profileKey:'PRODAT:Z04:L:26.A:r3',profileVersionId:'00000000-0000-4000-8000-000000000032',version:'26.A:r3',checksum:'synthetic-source-hash'}})}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:async()=>({profileKey:'synthetic',sourceHash:'evidence',messageProfileId:'profile',rulePackId:'pack'})}))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:async()=>({status:'tenant_resolved',companyId:state.source?.company_id,message:state.source,evidence:{companyId:state.source?.company_id}})}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>{state.effects.push('actor');return null}}))
vi.mock('@/lib/ediel/inbound/inboundFacilityRecognition',()=>({recognizeInboundFacilityData:async()=>{state.effects.push('facility');return null}}))
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointForEdielMessage:async()=>null,matchSiteAndCustomerForMeteringPoint:async()=>null,findMatchingSupplierSwitchRequest:async()=>null}))
vi.mock('@/lib/ediel/inboundCases',async original=>({...await original<Record<string,unknown>>(),createOrUpdateInboundProdatCase:async()=>{state.effects.push('case');return null}}))
vi.mock('@/lib/onboarding/inboundEdielLinking',()=>({applyInboundProdatZ02ToCustomerInfoRequest:async()=>{state.effects.push('z02')},applyInboundProdatZ14ToMeteringPermission:async()=>{state.effects.push('z14')}}))
vi.mock('@/lib/ediel/flows/inboundBusinessStateMachine',()=>({applyInboundBusinessStateMachine:async()=>{state.effects.push('business')}}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:async()=>null}))

import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'

function mixed():Parts[]{return [...head(),line('1','735123456789012345','1','9'),qty('10'),...common('735123456789012345','A'),
 ...characteristic('Z07','E22'),...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
 ['NAD','IT',['735123456789012345','','9'],'','Installation','Street','City','','12345','SE'],['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'],
 line('2','735123456789012345','2','9'),
 line('3','735123456789012352',undefined,'9'),qty('30'),...common('735123456789012352','B'),
 ...characteristic('Z07','E22'),...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
 ['NAD','IT',['735123456789012352','','9'],'','Installation','Street','City','','12345','SE'],['NAD','Z02',['54321','160','SVK'],'','','','','','','SE']]}

beforeEach(()=>{state.messages=[];state.outbox=[];state.events=[];state.effects=[];state.routeAvailable=true;state.source={...source(raw(mixed(),'Z04'),'Z04'),company_id:'00000000-0000-4000-8000-000000000002',status:'received',
 canonical_rule_pack_id:'00000000-0000-4000-8000-000000000033',rule_profile_key:'PRODAT:Z04:L:26.A:r3',rule_profile_version_id:'00000000-0000-4000-8000-000000000032',rule_profile_version:'26.A:r3',rule_pack_checksum:'synthetic-source-hash',rule_pack_snapshot:{profileKey:'PRODAT:Z04:L:26.A:r3',profileVersionId:'00000000-0000-4000-8000-000000000032',version:'26.A:r3',checksum:'synthetic-source-hash'},parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow})

it('stores one routed CONTRL and one first-object negative APERAK without a sibling success or business effect',async()=>{
 expect(resolveCanonicalRuntimeDecision(state.source!)).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source!.id})
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(state.messages.every(row=>row.company_id===state.source!.company_id&&row.communication_route_id==='00000000-0000-4000-8000-000000000030'&&row.route_profile_id==='00000000-0000-4000-8000-000000000031'&&row.related_message_id===state.source!.id)).toBe(true)
 expect(String(state.messages[1].raw_payload)).toContain('FTX+AAO++213::260')
 expect(String(state.messages[1].raw_payload)).toContain('RFF+Z07:735123456789012345')
 expect(String(state.messages[1].raw_payload)).not.toContain('RFF+Z07:735123456789012352')
 expect(state.outbox.map(row=>row.status),JSON.stringify({messages:state.messages.map(row=>row.status),events:state.events.filter(event=>String(event.message).includes('skapades inte'))})).toEqual(['queued','queued'])
 expect(state.outbox.every(row=>row.company_id===state.source!.company_id&&row.environment==='test'&&row.source_message_id===state.source!.id)).toBe(true)
 expect(state.effects).toEqual([])
})

it('reuses both persisted ACKs and their unique outbox locks on the same original retry',async()=>{
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source!.id}
 await processInboundEdielMessage(input)
 const ids=state.messages.map(row=>row.id),locks=state.outbox.map(row=>row.lock_key)
 await processInboundEdielMessage(input)
 expect(state.messages.map(row=>row.id)).toEqual(ids)
 expect(state.outbox.map(row=>row.lock_key)).toEqual(locks)
 expect(state.outbox).toHaveLength(2)
 expect(state.effects).toEqual([])
})

it('holds both ACKs when the tenant has no qualified outbound route',async()=>{
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source!.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.events.filter(event=>String(event.message).includes('skapades inte')).map(event=>event.payload)).toEqual([
  expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'}),
  expect.objectContaining({ackFamily:'APERAK',blockedBy:'canonical_inbound_ack_guard'}),
 ])
 expect(state.effects).toEqual([])
})
