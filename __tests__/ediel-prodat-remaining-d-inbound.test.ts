import {beforeEach,it,expect,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const state=vi.hoisted(()=>({message:{} as EdielMessageRow, effects:[] as string[], drafts:[] as Record<string,unknown>[], events:[] as Record<string,unknown>[], inject:false,registryFailure:false,sourceReceiptFailure:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async importOriginal=>({...await importOriginal<Record<string,unknown>>(),resolveCanonicalRulePack:async()=>{if(state.registryFailure)throw Error('Injected registry failure');return (await import('./helpers/prodatInboundSourceFixture')).prodatFixtureRegistryResolution}}))
vi.mock('@/lib/supabase/service',async()=>({supabaseService:{from:()=>{throw Error('UNEXPECTED_DB')},rpc:(name:string,args:Record<string,unknown>)=>{if(state.sourceReceiptFailure&&name==='gridex_record_prodat_source_validation_v6'){const result=Promise.resolve({data:null,error:{message:'Declared source receipt failure'}});return Object.assign(result,{abortSignal:()=>result})}return prodatFixtureSourceRpc(name,args)}}}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>state.message,createEdielMessageEvent:async(p:Record<string,unknown>)=>{state.events.push(p)},updateEdielMessageStatus:async(p:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{state.message={...state.message,status:p.status,parsed_payload:p.parsedPayload??state.message.parsed_payload,validation_report:p.validationReport?JSON.parse(JSON.stringify(p.validationReport)):state.message.validation_report} as EdielMessageRow;return state.message},linkEdielMessage:async()=>{state.effects.push('link')},listAckMessagesForSource:async()=>[],getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[]}))
// Actual actor authority stays enforced: only the run's actor in the source's
// own company passes; the DB membership read itself is out of unit scope.
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:async(input:{companyId:string;actorUserId:string})=>{if(input.actorUserId!=='00000000-0000-4000-8000-000000000002'||input.companyId!==state.message.company_id)throw Error('ediel_tenant_permission_forbidden')}}))
vi.mock('@/lib/ediel/core/messageBuilder',async importOriginal=>(await import('./helpers/p16bHold')).captureP16bPreflight(importOriginal))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:async()=>({status:'tenant_resolved',companyId:state.message.company_id,message:state.message,evidence:{companyId:state.message.company_id}})}))
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
import {expectOwnReferencePair,p16bBlockedAperaks} from './helpers/p16bHold'
import {prodatFixtureSourceRpc,withProdatFixtureInsertContext} from './helpers/prodatInboundSourceFixture'

import {permissionAckMessage as message,alphabets,characteristic} from './fixtures/prodat-permission-ack'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielAperakApplicationError} from '@/lib/ediel/ack'
beforeEach(()=>{p16bBlockedAperaks.length=0;state.effects=[];state.drafts=[];state.events=[];state.registryFailure=false;state.sourceReceiptFailure=false})
const run=(message:EdielMessageRow)=>{state.message=withProdatFixtureInsertContext({...message,status:'received',parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow);return processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000002',edielMessageId:message.id})}

import {changeBody,changeFields} from './fixtures/prodat-meter-change'
import {deathBody} from './fixtures/prodat-death-status'
import {payload} from './fixtures/prodat-gas'
import {source,head} from './fixtures/prodat-identity'
import {raw} from './fixtures/prodat-register'
for(const a of alphabets)for(const cell of ['321','323','254','242','Z05-310','Z06-310','Z09-310','Z04-320','Z06-320'])it(`selected persist/reload final renderer ${cell}/${a.join('')}`,async()=>{
 const field=cell.slice(-3),code=cell.includes('-')?cell.slice(0,3):['321','323'].includes(field)?'Z14':'Z10'
 let m:EdielMessageRow=message('Z14','S18','A74',null,a)
 if(code==='Z14')m.raw_payload=m.raw_payload!.replace(field==='321'?'202611010000':'B72',field==='321'?'202602300000':'BAD')
 // ACK qualification needs the original own legal NAD identity and country.
 // These explicit synthetic source headers preserve the independently chosen
 // invalid own field and service alphabet; row metadata is not ACK authority.
 else if(code==='Z10')m=source(raw([...head(),...changeBody(changeFields(field==='254'?'BAD':'Z32',field==='242'?'BAD':'L639Q'))],code,a),code)
 else if(field==='310')m=source(raw([...head(),...deathBody(code==='Z05'?'Z23':'E34',characteristic('Z17','BAD'))],code,a),code)
 else m=source(payload(code,code==='Z04'?'Z22':'E32',[], 'gas',a),code)
 if(field==='320'){await expect(run(m)).rejects.toThrow('ediel_guide_resolution_missing:PRODAT:2026-09-20:E2SE6B')
  // The wire-level technical CONTRL precedes routing and grants no guide
  // approval; an unresolved guide yields no application response at all.
  expect(state.drafts.map(d=>d.messageFamily)).toEqual(['CONTRL']);expect(String(state.drafts[0].rawPayload)).not.toContain('UCI+I+S+R+4');return}
 await run(m)
 const report=JSON.parse(JSON.stringify(state.message.validation_report)) as {responsePlan:{family:string;applicationErrors?:EdielAperakApplicationError[]}[]}
 const errors=report.responsePlan.flatMap(p=>p.applicationErrors??[]).filter(e=>e.fieldCode===field)
 expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ercCode:field==='320'?'41':'42',fieldCode:field,prodatOccurrence:{...errors[0]?.prodatOccurrence,lineIndex:0},prodatFieldDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field}),prodatAperakText:expect.objectContaining({kind:'ready'})})]))
 // P16B resolved: the own ERC carries both RFF+Z07 and RFF+LI (E2SE6A).
 const aperaks=state.drafts.filter(d=>d.messageFamily==='APERAK').map(d=>String(d.rawPayload))
 expectOwnReferencePair(aperaks)
 for(const raw of aperaks){const wire=tokenizeEdifact(raw);expect(wire.segments.filter(t=>t.tag==='FTX').map(t=>segmentComposite(t,3,wire.una)[0])).toContain(field);expect(raw).not.toContain('ERC+100')}
})
it('selected mixed321 F and323 text I survives persistence and prevents business',async()=>{
 const m=message('Z14','S18');m.raw_payload=m.raw_payload!.replace('202611010000','202602300000').replace('B72','X'.repeat(80));await run(m)
 // CAV/C889/7111 is an..3 in PRODAT D.97A: the 80-character 323 value is a
 // full-directory syntax rejection, so no application response or business.
 expect(state.message.validation_report).toMatchObject({canonicalRuntime:{issues:expect.arrayContaining([expect.objectContaining({code:'UNSM_ELEMENT_LENGTH_INVALID',layer:'syntax'})])}})
 expect(state.drafts.filter(d=>d.messageFamily==='APERAK')).toEqual([]);expect(state.drafts.map(d=>d.rawPayload).join('')).not.toContain('ERC+100');expect(state.effects).not.toContain('business')
})

it('keeps the actual source gate closed when its named canonical receipt is unconfirmed',async()=>{
 state.sourceReceiptFailure=true
 const m=message('Z14','S18');m.raw_payload=m.raw_payload!.replace('202611010000','202602300000')
 await expect(run(m)).rejects.toThrow('prodat_canonical_source_validation_unconfirmed')
 // Only the wire-level technical CONTRL precedes the closed source gate.
 expect(state.drafts.map(d=>d.messageFamily)).toEqual(['CONTRL']);expect(state.effects).toEqual([])
})
