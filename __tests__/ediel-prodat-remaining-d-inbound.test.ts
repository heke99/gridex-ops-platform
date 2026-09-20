import {beforeEach,it,expect,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const state=vi.hoisted(()=>({message:{} as EdielMessageRow, effects:[] as string[], drafts:[] as Record<string,unknown>[], events:[] as Record<string,unknown>[], inject:false,registryFailure:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:async()=>{if(state.registryFailure)throw Error('Injected registry failure');return {profileKey:'synthetic',sourceHash:'evidence',messageProfileId:'profile',rulePackId:'pack'}}}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('UNEXPECTED_DB')}}}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>state.message,createEdielMessageEvent:async(p:Record<string,unknown>)=>{state.events.push(p)},updateEdielMessageStatus:async(p:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{state.message={...state.message,status:p.status,parsed_payload:p.parsedPayload??state.message.parsed_payload,validation_report:p.validationReport?JSON.parse(JSON.stringify(p.validationReport)):state.message.validation_report} as EdielMessageRow;return state.message},linkEdielMessage:async()=>{state.effects.push('link')},listAckMessagesForSource:async()=>[],getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[]}))
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

import {permissionAckMessage as message,alphabets,characteristic} from './fixtures/prodat-permission-ack'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielAperakApplicationError} from '@/lib/ediel/ack'
beforeEach(()=>{state.effects=[];state.drafts=[];state.events=[];state.registryFailure=false})
const run=(message:EdielMessageRow)=>{state.message={...message,message_received_at:'2026-09-20T00:00:00Z',status:'received',company_id:'tenant',parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow;return processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000002',edielMessageId:message.id})}

import {changeRaw,changeBody,changeFields} from './fixtures/prodat-meter-change'
import {deathRaw,deathBody} from './fixtures/prodat-death-status'
import {payload} from './fixtures/prodat-gas'
import {source} from './fixtures/prodat-identity'
for(const a of alphabets)for(const cell of ['321','323','254','242','Z05-310','Z06-310','Z09-310','Z04-320','Z06-320'])it(`selected persist/reload final renderer ${cell}/${a.join('')}`,async()=>{
 const field=cell.slice(-3),code=cell.includes('-')?cell.slice(0,3):['321','323'].includes(field)?'Z14':'Z10'
 let m:EdielMessageRow=message('Z14','S18','A74',null,a)
 if(code==='Z14')m.raw_payload=m.raw_payload!.replace(field==='321'?'202611010000':'B72',field==='321'?'202602300000':'BAD')
 else if(code==='Z10')m=source(changeRaw(changeBody(changeFields(field==='254'?'BAD':'Z32',field==='242'?'BAD':'L639Q')),a),code)
 else if(field==='310')m=source(deathRaw(code,deathBody(code==='Z05'?'Z23':'E34',characteristic('Z17','BAD')),a),code)
 else m=source(payload(code,code==='Z04'?'Z22':'E32',[], 'gas',a),code)
 if(field==='320'){await expect(run(m)).rejects.toThrow('ediel_guide_resolution_missing:PRODAT:2026-09-20:E2SE6B');expect(state.drafts).toEqual([]);return}
 await run(m)
 const report=JSON.parse(JSON.stringify(state.message.validation_report)) as {responsePlan:{family:string;applicationErrors?:EdielAperakApplicationError[]}[]}
 const errors=report.responsePlan.flatMap(p=>p.applicationErrors??[]).filter(e=>e.fieldCode===field)
 expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ercCode:field==='320'?'41':'42',fieldCode:field,prodatOccurrence:{...errors[0]?.prodatOccurrence,lineIndex:0},prodatFieldDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field}),prodatAperakText:expect.objectContaining({kind:'ready'})})]))
 const drafts=state.drafts.filter(d=>d.messageFamily==='APERAK');expect(drafts.length).toBeGreaterThan(0)
 const wire=tokenizeEdifact(String(drafts[0].rawPayload));expect(wire.segments.filter(t=>t.tag==='FTX').map(t=>segmentComposite(t,3,wire.una)[0])).toContain(field)
 expect(drafts.map(d=>d.rawPayload).join('')).not.toContain('ERC+100')
})
it('selected mixed321 F and323 text I survives persistence and prevents business',async()=>{
 const m=message('Z14','S18');m.raw_payload=m.raw_payload!.replace('202611010000','202602300000').replace('B72','X'.repeat(80));await run(m)
 expect(state.message.validation_report).toMatchObject({prodatProcessingDisposition:{kind:'internal_review'}})
 const wire=state.drafts.map(d=>d.rawPayload).join('');expect(wire).toContain('FTX+AAO++321::260');expect(wire).not.toContain('FTX+AAO++323::260');expect(wire).not.toContain('ERC+100');expect(state.effects).not.toContain('business');expect(JSON.stringify(state.message.validation_report)).toContain('X'.repeat(80))
})
