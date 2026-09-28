import {beforeEach,expect,it,vi} from 'vitest'
import {qty,raw} from './fixtures/prodat-register'
import {source} from './fixtures/prodat-identity'
import {mixedZ04Parts} from './helpers/mixedZ04Fixture'
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
import {buildAperakDraft} from '@/lib/ediel/ack'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {classifyCanonicalInboundAck} from '@/lib/ediel/ack/inboundAckOutcome'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatHeaderFieldRejection} from '@/lib/ediel/prodat/prodatHeaderDateRejection'

beforeEach(()=>{state.messages=[];state.outbox=[];state.events=[];state.effects=[];state.routeAvailable=true;state.source={...source(raw(mixedZ04Parts(),'Z04'),'Z04'),company_id:'00000000-0000-4000-8000-000000000002',status:'received',
 canonical_rule_pack_id:'00000000-0000-4000-8000-000000000033',rule_profile_key:'PRODAT:Z04:L:26.A:r3',rule_profile_version_id:'00000000-0000-4000-8000-000000000032',rule_profile_version:'26.A:r3',rule_pack_checksum:'synthetic-source-hash',rule_pack_snapshot:{profileKey:'PRODAT:Z04:L:26.A:r3',profileVersionId:'00000000-0000-4000-8000-000000000032',version:'26.A:r3',checksum:'synthetic-source-hash'},parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow})

it.each([
 ['missing','BGM++D+9+AB'],
 ['unlisted','BGM+Z99+D+9+AB'],
])('holds a %s field 202 code at the policy boundary without business effects or an invented APERAK',async(_kind,bgm)=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,message_received_at:'2026-09-28T09:00:00Z',raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB',bgm)} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected',policy:null})
 expect(decision.responsePlan.find(item=>item.family==='APERAK')?.applicationErrors).toBeUndefined()
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.effects).toEqual([])
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','positive']])
 expect(state.messages[0]).toMatchObject({company_id:state.source!.company_id,
  related_message_id:state.source!.id,communication_route_id:'00000000-0000-4000-8000-000000000030'})
 expect(state.messages.filter(row=>row.message_family==='APERAK')).toEqual([])
 expect(state.outbox).toHaveLength(1)
 expect(state.outbox.every(row=>row.company_id===state.source!.company_id)).toBe(true)
 expect(state.events).toEqual(expect.arrayContaining([expect.objectContaining({payload:expect.objectContaining({ackFamily:'APERAK',blockedBy:'canonical_inbound_ack_guard'})})]))
 const first={messages:state.messages.map(row=>row.id),outbox:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({messages:state.messages.map(row=>row.id),outbox:state.outbox.map(row=>row.lock_key)}).toEqual(first)
 expect(state.effects).toEqual([])
})

it('holds an unresolved field 202 source without a tenant-qualified ACK route',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,message_received_at:'2026-09-28T09:00:00Z',raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB','BGM+Z99+D+9+AB')} as EdielMessageRow
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.effects).toEqual([])
 expect(state.events).toEqual(expect.arrayContaining([
  expect.objectContaining({payload:expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'})}),
  expect.objectContaining({payload:expect.objectContaining({ackFamily:'APERAK',blockedBy:'canonical_inbound_ack_guard'})}),
 ]))
})

it('rejects supplied forbidden C002 metadata in field 202 as a whole-message ACK before business effects',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB','BGM+Z04:BOGUS+D+9+AB')} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(row=>row.family==='APERAK')!
 expect(plan).toMatchObject({outcome:'negative',applicationErrors:expect.arrayContaining([
  expect.objectContaining({fieldCode:'202',ercCode:'42',prodatOccurrence:expect.objectContaining({scope:'header'})}),
 ])})
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'positive'})).toThrow('aperak_prodat_header_202_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[{ercCode:'42',fieldCode:'202',text:'invented'}]}))
  .toThrow('aperak_prodat_header_202_response_unqualified')
 const other={...state.source!,raw_payload:state.source!.raw_payload!.replace('UNH+M+','UNH+OTHER+').replace('+M\'UNZ','+OTHER\'UNZ')} as EdielMessageRow
 const foreign=resolveCanonicalRuntimeDecision(other).responsePlan.find(row=>row.family==='APERAK')!.applicationErrors!
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:foreign})).toThrow('aperak_prodat_header_202_response_unqualified')
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.effects).toEqual([])
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(state.messages.every(row=>row.company_id===state.source!.company_id&&row.related_message_id===state.source!.id&&row.communication_route_id==='00000000-0000-4000-8000-000000000030')).toBe(true)
 const aperak=String(state.messages[1].raw_payload)
 expect(aperak).toContain('BGM+++27')
 expect(aperak).toContain('ERC+42::260')
 expect(aperak).toContain('FTX+AAO++202::260')
 expect(aperak).toContain('RFF+ACW:D')
 expect(aperak).not.toContain('RFF+Z07:')
 expect(state.outbox).toHaveLength(2)
 expect(state.outbox.every(row=>row.company_id===state.source!.company_id)).toBe(true)
 const before={ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}).toEqual(before)
 expect(state.effects).toEqual([])
})

it('accepts an ordinary field 202 code and holds a malformed header when the tenant has no ACK route',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 const wire=raw(parts,'Z04')
 const ordinary={...state.source!,raw_payload:wire} as EdielMessageRow
 expect(prodatHeaderFieldRejection({field:'202',sourceWire:tokenizeEdifact(wire),errors:[]})).toMatchObject({defect:null,qualified:false})
 expect(resolveCanonicalRuntimeDecision(ordinary).applicationDecision).toBe('accepted')
 expect(buildAperakDraft({sourceMessage:ordinary,outcome:'positive'}).rawPayload).toContain('BGM+++34')
 state.source={...state.source!,raw_payload:wire.replace('BGM+Z04+D+9+AB','BGM+Z04:BOGUS+D+9+AB')} as EdielMessageRow
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.effects).toEqual([])
})

it('rejects invalid optional header 204 as one routed whole-message ACK with stable retry and no business effect',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB','BGM+Z04+D+7+AB')} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(row=>row.family==='APERAK')!
 expect(plan).toMatchObject({outcome:'negative',applicationErrors:expect.arrayContaining([expect.objectContaining({fieldCode:'204',ercCode:'42',prodatOccurrence:expect.objectContaining({scope:'header'})})])})
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'positive'})).toThrow('aperak_prodat_header_204_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[{ercCode:'42',fieldCode:'204',text:'invented'}]}))
  .toThrow('aperak_prodat_header_204_response_unqualified')
 const other={...state.source,raw_payload:state.source.raw_payload!.replace('UNH+M+','UNH+OTHER+').replace('+M\'UNZ','+OTHER\'UNZ')} as EdielMessageRow
 const foreign=resolveCanonicalRuntimeDecision(other).responsePlan.find(row=>row.family==='APERAK')!.applicationErrors!
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:foreign})).toThrow('aperak_prodat_header_204_response_unqualified')
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.effects).toEqual([])
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(state.messages.every(row=>row.company_id===state.source!.company_id&&row.related_message_id===state.source!.id&&row.communication_route_id==='00000000-0000-4000-8000-000000000030')).toBe(true)
 const aperak=String(state.messages[1].raw_payload)
 expect(aperak).toContain('BGM+++27')
 expect(aperak).toContain('ERC+42::260')
 expect(aperak).toContain('FTX+AAO++204::260')
 expect(aperak).toContain('RFF+ACW:D')
 expect(aperak).not.toContain('RFF+Z07:')
 expect(state.outbox).toHaveLength(2)
 expect(state.outbox.every(row=>row.company_id===state.source!.company_id)).toBe(true)
 const before={ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}).toEqual(before)
 expect(state.effects).toEqual([])
})

it('keeps optional missing 204 and documented 9/5 outside header rejection, and holds no-route invalid 204',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 const wire=raw(parts,'Z04')
 for(const value of ['', '9','5']){
  const candidate=wire.replace('BGM+Z04+D+9+AB',`BGM+Z04+D+${value}+AB`)
  expect(prodatHeaderFieldRejection({field:'204',sourceWire:tokenizeEdifact(candidate),errors:[]})).toMatchObject({defect:null,qualified:false})
  const message={...state.source!,raw_payload:candidate} as EdielMessageRow
  expect(resolveCanonicalRuntimeDecision(message).applicationDecision).toBe('accepted')
  expect(buildAperakDraft({sourceMessage:message,outcome:'positive'}).rawPayload).toContain('BGM+++34')
 }
 state.source={...state.source!,raw_payload:wire.replace('BGM+Z04+D+9+AB','BGM+Z04+D+7+AB')} as EdielMessageRow
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.effects).toEqual([])
})

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

it('persists whole-message P-17 rejection as BGM27, with original correlation and no case effect',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts[second]=[...parts[second].slice(0,1),'4',...parts[second].slice(2)]
 state.source={...state.source!,raw_payload:raw(parts,'Z04')} as EdielMessageRow
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id}
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision.responsePlan.find(item=>item.family==='APERAK')).toMatchObject({outcome:'negative',applicationErrors:expect.arrayContaining([expect.objectContaining({ercCode:'42',fieldCode:'314'})])})
 await processInboundEdielMessage(input)
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','positive'],['APERAK','negative']])
 const wire=String(state.messages[1].raw_payload)
 expect(wire).toContain('BGM+++27')
 expect(wire).toContain('RFF+ACW:D')
 expect(wire).toContain('FTX+AAO++314::260')
 expect(wire).not.toContain('BGM+++34')
 expect(classifyCanonicalInboundAck(parseEdifactPayload(wire))).toMatchObject({profile:'PRODAT_16_B',outcome:'negative'})
 expect(state.messages.every(row=>row.company_id===state.source!.company_id&&row.related_message_id===state.source!.id)).toBe(true)
 expect(state.outbox).toHaveLength(2)
 expect(state.effects).toEqual([])
 const before={messages:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({messages:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}).toEqual(before)
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

it.each(['first LIN 2','duplicate LIN 1'] as const)('rejects %s as one whole message, retaining the 314 error',defect=>{
 const parts=mixedZ04Parts()
 const index=defect==='first LIN 2' ? parts.findIndex(part=>part[0]==='LIN') : parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts[index]=[...parts[index].slice(0,1),defect==='first LIN 2'?'2':'1',...parts[index].slice(2)]
 const sourceMessage={...state.source!,raw_payload:raw(parts,'Z04')} as EdielMessageRow
 const plan=resolveCanonicalRuntimeDecision(sourceMessage).responsePlan.find(item=>item.family==='APERAK')!
 const draft=buildAperakDraft({sourceMessage,outcome:'negative',applicationErrors:plan.applicationErrors})
 expect(draft.rawPayload).toContain('BGM+++27')
 expect(draft.rawPayload).toContain('FTX+AAO++314::260')
})

it('holds a sequence rejection without a source-qualified 314 finding, including a positive shortcut',()=>{
 const parts=mixedZ04Parts()
 const index=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts[index]=[...parts[index].slice(0,1),'4',...parts[index].slice(2)]
 const sourceMessage={...state.source!,raw_payload:raw(parts,'Z04')} as EdielMessageRow
 expect(()=>buildAperakDraft({sourceMessage,outcome:'negative',applicationErrors:[{ercCode:'42',fieldCode:'314',text:'invented'}]}))
  .toThrow('aperak_prodat_sequence_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage,outcome:'positive'})).toThrow('aperak_prodat_sequence_response_unqualified')
})

it('does not borrow a qualified 314 finding from another physical object',()=>{
 const own=mixedZ04Parts(),other=mixedZ04Parts()
 for(const parts of [own,other]) {
  const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
  parts[second]=[...parts[second].slice(0,1),'4',...parts[second].slice(2)]
 }
 const second=other.findIndex(part=>part[0]==='LIN'&&part[1]==='4')
 other[second]=[...other[second].slice(0,3),['735123456789012352','','','9'],...other[second].slice(4)]
 const sourceMessage={...state.source!,raw_payload:raw(own,'Z04')} as EdielMessageRow
 const otherMessage={...state.source!,raw_payload:raw(other,'Z04')} as EdielMessageRow
 const otherError=resolveCanonicalRuntimeDecision(otherMessage).responsePlan.find(item=>item.family==='APERAK')!
  .applicationErrors!.find(error=>error.fieldCode==='314')!
 expect(otherError.referenceNumber).toBe('735123456789012352')
 expect(()=>buildAperakDraft({sourceMessage,outcome:'negative',applicationErrors:[otherError]}))
  .toThrow('aperak_prodat_sequence_response_unqualified')
})

it.each([['missing','', '41'],['invalid','ZZ','42'],['lowercase','ab','42']] as const)(
 'rejects %s required header 313 as a whole message with a routed, retry-stable ACK and no business effects',async(_defect,value,erc)=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 const wire=raw(parts,'Z04').replace('BGM+Z04+D+9+AB',`BGM+Z04+D+9${value?`+${value}`:''}`)
 state.source={...state.source!,raw_payload:wire} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(item=>item.family==='APERAK')!
 expect(plan).toMatchObject({outcome:'negative',applicationErrors:expect.arrayContaining([
  expect.objectContaining({ercCode:erc,fieldCode:'313',prodatOccurrence:expect.objectContaining({scope:'header'})})
 ])})
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.effects).toEqual([])
 const draft=buildAperakDraft({sourceMessage:state.source,outcome:'negative',applicationErrors:plan.applicationErrors})
 expect(draft.rawPayload).toContain('BGM+++27')
 expect(draft.rawPayload).toContain('RFF+ACW:D')
 expect(draft.rawPayload).toContain('FTX+AAO++313::260')
 expect(draft.rawPayload).not.toContain('RFF+Z07:')
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(String(state.messages[1].raw_payload)).toContain('BGM+++27')
 expect(state.messages.every(row=>row.company_id===state.source!.company_id&&row.related_message_id===state.source!.id)).toBe(true)
 expect(state.outbox).toHaveLength(2)
 expect(state.effects).toEqual([])
 const before={ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}).toEqual(before)
 expect(state.effects).toEqual([])
})

it('does not treat the optional missing Z01 request as a header rejection',()=>{
 const wire=raw(mixedZ04Parts(),'Z01').replace('BGM+Z01+D+9+AB','BGM+Z01+D+9')
 expect(prodatHeaderFieldRejection({field:'313',sourceWire:tokenizeEdifact(wire),errors:[]}))
  .toMatchObject({defect:null,qualified:false,hasHeaderError:false})
 const na=raw(mixedZ04Parts(),'Z04').replace('BGM+Z04+D+9+AB','BGM+Z04+D+9+NA')
 expect(prodatHeaderFieldRejection({field:'313',sourceWire:tokenizeEdifact(na),errors:[]})).toMatchObject({defect:null})
})

it('holds a required 313 rejection without source-bound evidence or a qualified route',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,raw_payload:raw(parts,'Z04').replace('BGM+Z04+D+9+AB','BGM+Z04+D+9')} as EdielMessageRow
 const plan=resolveCanonicalRuntimeDecision(state.source).responsePlan.find(item=>item.family==='APERAK')!
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'positive'}))
  .toThrow('aperak_prodat_header_313_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[{ercCode:'41',fieldCode:'313',text:'invented'}]}))
  .toThrow('aperak_prodat_header_313_response_unqualified')
 const other={...state.source!,raw_payload:state.source!.raw_payload!.replace('UNH+M+','UNH+OTHER+').replace('+M\'UNZ','+OTHER\'UNZ')} as EdielMessageRow
 const foreign=resolveCanonicalRuntimeDecision(other).responsePlan.find(item=>item.family==='APERAK')!.applicationErrors!
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:foreign}))
  .toThrow('aperak_prodat_header_313_response_unqualified')
 expect(plan.applicationErrors).toEqual([expect.objectContaining({fieldCode:'313'})])
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.effects).toEqual([])
 expect(state.events.filter(event=>String(event.message).includes('skapades inte')).map(event=>event.payload)).toEqual([
  expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'}),
  expect.objectContaining({ackFamily:'APERAK',blockedBy:'canonical_inbound_ack_guard'}),
 ])
})

it('persists one whole-message rejection for missing required header 205, correlated without business effects, and reuses it on retry',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 const wire=raw(parts,'Z04').replace('DTM+137:202609171200:203\'','').replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)-1}+M`)
 const sourceMessage={...state.source!,raw_payload:wire} as EdielMessageRow
 state.source=sourceMessage
 const decision=resolveCanonicalRuntimeDecision(sourceMessage)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(item=>item.family==='APERAK')!
 expect(plan).toMatchObject({outcome:'negative',applicationErrors:expect.arrayContaining([
  expect.objectContaining({ercCode:'41',fieldCode:'205',prodatOccurrence:expect.objectContaining({scope:'header'})})
 ])})
 expect(plan.applicationErrors).toHaveLength(1)
 const draft=buildAperakDraft({sourceMessage,outcome:'negative',applicationErrors:plan.applicationErrors})
 expect(draft.rawPayload).toContain('BGM+++27')
 expect(draft.rawPayload).toContain('FTX+AAO++205::260')
 expect(draft.rawPayload).toContain('RFF+ACW:D')
 expect(draft.rawPayload).not.toContain('RFF+Z07:')
 expect(buildAperakDraft({sourceMessage:{...sourceMessage,message_code:'Z01'},outcome:'negative',applicationErrors:plan.applicationErrors}).rawPayload)
  .toContain('BGM+++27')
 expect(classifyCanonicalInboundAck(parseEdifactPayload(draft.rawPayload!))).toMatchObject({profile:'PRODAT_16_B',outcome:'negative'})
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:sourceMessage.id}
 await processInboundEdielMessage(input)
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(String(state.messages[1].raw_payload)).toContain('BGM+++27')
 expect(state.messages.every(row=>row.company_id===sourceMessage.company_id&&row.related_message_id===sourceMessage.id)).toBe(true)
 expect(state.outbox).toHaveLength(2)
 expect(state.effects).toEqual([])
 const before={ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}
 await processInboundEdielMessage(input)
 expect({ids:state.messages.map(row=>row.id),locks:state.outbox.map(row=>row.lock_key)}).toEqual(before)
 expect(state.effects).toEqual([])
})

it('does not accept a supplied 205 error or positive ACK as authority for a whole-message response',()=>{
 const sourceMessage=state.source!
 const wire=raw(mixedZ04Parts(),'Z04').replace('DTM+137:202609171200:203\'','').replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)-1}+M`)
 const defective={...sourceMessage,raw_payload:wire} as EdielMessageRow
 const plan=resolveCanonicalRuntimeDecision(defective).responsePlan.find(item=>item.family==='APERAK')!
 expect(()=>buildAperakDraft({sourceMessage:defective,outcome:'positive'})).toThrow('aperak_prodat_header_205_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:defective,outcome:'negative',applicationErrors:[{ercCode:'41',fieldCode:'205',text:'invented'}]})).toThrow('aperak_prodat_header_205_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage,outcome:'negative',applicationErrors:plan.applicationErrors})).toThrow('aperak_prodat_header_205_response_unqualified')
})

it('rejects a malformed supplied header date as ERC42/205 for the whole P message before business writes',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 state.source={...state.source!,raw_payload:raw(parts,'Z04').replace('DTM+137:202609171200:203','DTM+137:202613171200:203')} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(item=>item.family==='APERAK')!
 expect(plan.applicationErrors).toEqual([expect.objectContaining({ercCode:'42',fieldCode:'205',prodatOccurrence:expect.objectContaining({scope:'header'})})])
 // PostgreSQL jsonb persists object keys in a different order. A source-owned
 // finding must survive that round trip without accepting altered evidence.
 const error=plan.applicationErrors![0]
 if(error.prodatFieldDiagnostic?.kind!=='field' || !error.prodatFieldDiagnostic.failureEvidence) throw Error('expected source-owned field evidence')
 const persistedError={...error,prodatFieldDiagnostic:{...error.prodatFieldDiagnostic,
  failureEvidence:error.prodatFieldDiagnostic.failureEvidence.map(item=>({content:item.content,locator:item.locator,raw:item.raw}))}}
 expect(buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[persistedError]}).rawPayload).toContain('BGM+++27')
 const alteredError={...persistedError,prodatFieldDiagnostic:{...persistedError.prodatFieldDiagnostic,
  failureEvidence:persistedError.prodatFieldDiagnostic.failureEvidence.map(item=>({...item,content:'202614171200'}))}}
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[alteredError]}))
  .toThrow('aperak_prodat_header_205_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'positive'})).toThrow('aperak_prodat_header_205_response_unqualified')
 const other={...state.source!,raw_payload:state.source.raw_payload!.replace('202613171200','202614171200')} as EdielMessageRow
 const otherError=resolveCanonicalRuntimeDecision(other).responsePlan.find(item=>item.family==='APERAK')!.applicationErrors!
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:otherError}))
  .toThrow('aperak_prodat_header_205_response_unqualified')
 const input={actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id}
 await processInboundEdielMessage(input)
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(String(state.messages[1].raw_payload)).toContain('BGM+++27')
 expect(String(state.messages[1].raw_payload)).toContain('FTX+AAO++205::260')
 expect(state.effects).toEqual([])
})

it('rejects a duplicate header date as one whole message before business writes',async()=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 const wire=raw(parts,'Z04').replace('DTM+137:202609171200:203\'',"DTM+137:202609171200:203'DTM+137:202609181200:203'")
  .replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)+1}+M`)
 state.source={...state.source!,raw_payload:wire} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages.map(row=>row.message_family)).toEqual(['CONTRL','APERAK'])
 expect(String(state.messages[1].raw_payload)).toContain('BGM+++27')
 expect(String(state.messages[1].raw_payload)).toContain('FTX+AAO++205::260')
 expect(state.effects).toEqual([])
})

it.each(['missing','invalid'] as const)('rejects %s required header offset 206 as one whole P message before business writes',async defect=>{
 const parts=mixedZ04Parts()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,0,qty('20'))
 let wire=raw(parts,'Z04')
 if(defect==='missing') wire=wire.replace('DTM+ZZZ:1:805\'','').replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)-1}+M`)
 else wire=wire.replace('DTM+ZZZ:1:805','DTM+ZZZ:2:805')
 state.source={...state.source!,raw_payload:wire} as EdielMessageRow
 const decision=resolveCanonicalRuntimeDecision(state.source)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 const plan=decision.responsePlan.find(item=>item.family==='APERAK')!
 expect(plan.applicationErrors).toEqual([expect.objectContaining({ercCode:defect==='missing'?'41':'42',fieldCode:'206',prodatOccurrence:expect.objectContaining({scope:'header'})})])
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'positive'})).toThrow('aperak_prodat_header_206_response_unqualified')
 expect(()=>buildAperakDraft({sourceMessage:state.source!,outcome:'negative',applicationErrors:[{ercCode:defect==='missing'?'41':'42',fieldCode:'206',text:'invented'}]}))
  .toThrow('aperak_prodat_header_206_response_unqualified')
 const draft=buildAperakDraft({sourceMessage:state.source,outcome:'negative',applicationErrors:plan.applicationErrors})
 expect(draft.rawPayload).toContain('BGM+++27')
 expect(draft.rawPayload).toContain('FTX+AAO++206::260')
 expect(draft.rawPayload).toContain('RFF+ACW:D')
 expect(draft.rawPayload).not.toContain('RFF+Z07:')
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages.map(row=>[row.message_family,row.ack_outcome])).toEqual([['CONTRL','positive'],['APERAK','negative']])
 expect(String(state.messages[1].raw_payload)).toContain('BGM+++27')
 expect(state.outbox).toHaveLength(2)
 expect(state.effects).toEqual([])
})

it('holds a header rejection without a qualified tenant ACK route and never enters business processing',async()=>{
 const wire=raw(mixedZ04Parts(),'Z04').replace('DTM+137:202609171200:203\'','').replace(/UNT\+(\d+)\+M/,(_,count:string)=>`UNT+${Number(count)-1}+M`)
 state.source={...state.source!,raw_payload:wire} as EdielMessageRow
 state.routeAvailable=false
 await processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000009',edielMessageId:state.source.id})
 expect(state.messages).toEqual([])
 expect(state.outbox).toEqual([])
 expect(state.events.filter(event=>String(event.message).includes('skapades inte')).map(event=>event.payload)).toEqual([
  expect.objectContaining({ackFamily:'CONTRL',blockedBy:'canonical_inbound_ack_guard'}),
  expect.objectContaining({ackFamily:'APERAK',blockedBy:'canonical_inbound_ack_guard'}),
 ])
 expect(state.effects).toEqual([])
})
