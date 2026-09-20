import {beforeEach,it,expect,vi} from 'vitest'
import {raw,characteristic} from './fixtures/prodat-register'
import {source,z10,head,own} from './fixtures/prodat-identity'
import type {EdielMessageRow} from '@/lib/ediel/types'
const state=vi.hoisted(()=>({message:{} as EdielMessageRow, effects:[] as string[], drafts:[] as Record<string,unknown>[], events:[] as Record<string,unknown>[], inject:false,registryFailure:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:async()=>{if(state.registryFailure)throw Error('Injected registry failure');return {profileKey:'synthetic',sourceHash:'evidence',messageProfileId:'profile',rulePackId:'pack'}}}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('UNEXPECTED_DB')}}}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>state.message,createEdielMessageEvent:async(p:Record<string,unknown>)=>{state.events.push(p)},updateEdielMessageStatus:async(p:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{state.message={...state.message,status:p.status,parsed_payload:p.parsedPayload??state.message.parsed_payload,validation_report:p.validationReport??state.message.validation_report} as EdielMessageRow;return state.message},linkEdielMessage:async()=>{state.effects.push('link')},listAckMessagesForSource:async()=>[],getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[]}))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:async()=>({status:'tenant_resolved',message:state.message,evidence:{companyId:'tenant'}})}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:async(p:{ackFamily:string;draft:Record<string,unknown>})=>{state.drafts.push(p.draft);return {id:p.ackFamily,status:'sent'}}}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>{state.effects.push('actor-auto');return null}}))
vi.mock('@/lib/ediel/inbound/inboundFacilityRecognition',()=>({recognizeInboundFacilityData:async()=>{state.effects.push('facility');return null}}))
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointForEdielMessage:async()=>null,matchSiteAndCustomerForMeteringPoint:async()=>null,findMatchingSupplierSwitchRequest:async()=>null}))
vi.mock('@/lib/ediel/inboundCases',()=>({createOrUpdateInboundProdatCase:async()=>{state.effects.push('case');return null}}))
vi.mock('@/lib/onboarding/inboundEdielLinking',()=>({applyInboundProdatZ02ToCustomerInfoRequest:async()=>{state.effects.push('z02');return null},applyInboundProdatZ14ToMeteringPermission:async()=>{state.effects.push('z14');return null}}))
vi.mock('@/lib/ediel/flows/inboundBusinessStateMachine',()=>({applyInboundBusinessStateMachine:async()=>{state.effects.push('business');return null}}))
vi.mock('@/lib/ediel/operationalVerification',()=>({buildSafeMasterdataProposal:async()=>[{field:'synthetic',reviewRequired:true}]}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:async()=>null}))
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'

import {permissionMessage} from './fixtures/prodat-energy-product'
beforeEach(()=>{state.effects=[];state.drafts=[];state.events=[];state.registryFailure=false})
const run=(message:EdielMessageRow)=>{state.message={...message,status:'received',company_id:'tenant',parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow;return processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000002',edielMessageId:message.id})}
for(const code of ['Z13','Z14'])for(const energy of [null,'INVALID','8716867000030'])it(`persists actual ${code}/${energy} plan and builds exact own506 ACK`,async()=>{
 await run(permissionMessage(code,'S17',energy))
 const erc=energy===null?'41':energy==='INVALID'?'42':null
 expect(state.message.validation_report).toMatchObject({applicationDecision:erc?'rejected':'accepted',prodatProcessingDisposition:{kind:'continue'},responsePlan:expect.arrayContaining([expect.objectContaining({family:'APERAK',outcome:erc?'negative':'positive'})])})
 const report=JSON.parse(JSON.stringify(state.message.validation_report)) as {responsePlan:{family:string;applicationErrors?:{fieldCode:string;ercCode:string}[]}[]}
 expect(report.responsePlan.find(p=>p.family==='APERAK')?.applicationErrors??[]).toMatchObject(erc?[{fieldCode:'506',ercCode:erc}]:[])
 const wire=state.drafts.map(d=>d.rawPayload).join('');expect(wire).toContain(`ERC+${erc??'100'}::260`)
 if(erc){expect(wire).toContain('FTX+AAO++506::260');expect(wire).toContain('RFF+LI:CASE?:A?+B??C');expect(wire).not.toContain('CACHED-UNRELATED');expect(wire).not.toContain('ERC+100::260')}
})
it('false extra506 persists no negative or hold and preserves raw evidence through staging',async()=>{
 const wire=raw([...head(),...own('1','735123456789012345','CASE'),...characteristic('Z14','INVALID',4)],'Z01')
 await run(source(wire));expect(state.message.raw_payload).toBe(wire);expect(state.message.validation_report).toMatchObject({applicationDecision:'accepted',prodatProcessingDisposition:{kind:'continue'}})
 expect(state.drafts.map(d=>d.messageFamily)).toEqual(['CONTRL']);expect(state.effects).toContain('business')
})
it('independent actual fourth242 invalid survives false506 through persisted plan and draft',async()=>{
 const body=z10();body.splice(3,0,['CCI','','Z14'],['CAV',['','','','INVALID','IGNORED']])
 await run(source(raw(body,'Z10'),'Z10'));const wire=state.drafts.map(d=>d.rawPayload).join('')
 expect(wire).toContain('FTX+AAO++242::260');expect(wire).not.toContain('FTX+AAO++506::260');expect(state.message.validation_report.prodatProcessingDisposition).toMatchObject({kind:'continue'})
})
