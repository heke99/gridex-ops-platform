import {createHash} from 'node:crypto'
import {beforeEach,it,expect,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const state=vi.hoisted(()=>({message:{} as EdielMessageRow, effects:[] as string[], drafts:[] as Record<string,unknown>[], events:[] as Record<string,unknown>[], inject:false,registryFailure:false,sourceReceiptFailure:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async importOriginal=>({...await importOriginal<Record<string,unknown>>(),resolveCanonicalRulePack:async()=>{if(state.registryFailure)throw Error('Injected registry failure');return (await import('./helpers/prodatInboundSourceFixture')).prodatFixtureRegistryResolution}}))
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'fixture@example.invalid',host:'smtp.example.invalid',port:465})}))
vi.mock('@/lib/supabase/service',async()=>({supabaseService:{from:(await import('./helpers/prodatInboundSourceFixture')).prodatFixtureSourceDatabase.from,rpc:(name:string,args:Record<string,unknown>)=>{
 // Declared prospective external owner transport only. Actual producers and
 // branded receipt checks run; this model is no native qualification proof.
 if(name==='gridex_record_prodat_source_validation_v6'){
  expect(args).toMatchObject({p_company_id:state.message.company_id,p_environment:state.message.environment,p_source_message_id:state.message.id,
   p_source_payload_hash:createHash('sha256').update(state.message.raw_payload!).digest('hex')})
  if(state.sourceReceiptFailure){const r=Promise.resolve({data:null,error:{message:'declared_current_source_receipt_failure'}});return Object.assign(r,{abortSignal:()=>r})}
 }
 return prodatFixtureSourceRpc(name,args)
}}}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>state.message,createEdielMessageEvent:async(p:Record<string,unknown>)=>{state.events.push(p)},updateEdielMessageStatus:async(p:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{state.message={...state.message,status:p.status,parsed_payload:p.parsedPayload??state.message.parsed_payload,validation_report:p.validationReport?JSON.parse(JSON.stringify(p.validationReport)):state.message.validation_report} as EdielMessageRow;return state.message},linkEdielMessage:async()=>{state.effects.push('link')},listAckMessagesForSource:async()=>[],getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[]}))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:async()=>({status:'tenant_resolved',companyId:state.message.company_id,message:state.message,evidence:{companyId:state.message.company_id}})}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:async(p:{ackFamily:string;sourceMessage:EdielMessageRow;draft:Record<string,unknown>})=>{state.drafts.push(p.draft);return (await import('./helpers/prodatInboundSourceFixture')).prodatFixtureAckResult(p)}}))
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
import {prodatFixtureSourceRpc,withProdatFixtureInsertContext} from './helpers/prodatInboundSourceFixture'

import {permissionAckMessage as message,permissionAckObject as object,alphabets,characteristic} from './fixtures/prodat-permission-ack'
import type {EdielAperakApplicationError} from '@/lib/ediel/ack'
beforeEach(()=>{state.effects=[];state.drafts=[];state.events=[];state.registryFailure=false;state.sourceReceiptFailure=false})
const run=(message:EdielMessageRow)=>{state.message=withProdatFixtureInsertContext({...message,status:'received',parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow);return processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000002',edielMessageId:message.id})}
for(const a of alphabets)for(const [code,status,end,field] of [['Z14',"x:+",null,'322'],['Z15','A74',"x:+",'324'],['Z18',null,'X99','324']] as const)it(`persist/reload own field diagnosis and hold conflicting dual reference ${code}/${a.join('')}`,async()=>{
 const m=message(code,'S17',status,end,a);await run(m)
 const report=JSON.parse(JSON.stringify(state.message.validation_report)) as {responsePlan:{family:string;applicationErrors?:EdielAperakApplicationError[]}[]}
 const errors=report.responsePlan.flatMap(p=>p.applicationErrors??[]).filter(e=>e.fieldCode===field)
 expect(errors).toMatchObject([{ercCode:'42',fieldCode:field,prodatOccurrence:{lineIndex:0},prodatFieldDiagnostic:{kind:'field',fieldNumber:field},prodatAperakText:{kind:'ready'}}])
 // Full96A has SG4 C1/RFF M1 while the Swedish source requires both
 // original Z07 and LI. Preserve the typed own diagnosis and hold the wire;
 // never drop correlation, duplicate ERC or exempt the directory guard.
 expect(state.drafts.filter(d=>d.messageFamily==='APERAK')).toEqual([])
 expect(state.events.some(e=>String(e.message).includes('UNSM_MESSAGE_STRUCTURE_INVALID'))).toBe(true)
 expect(state.message.raw_payload).toBe(m.raw_payload);expect(state.message.validation_report).toMatchObject({applicationDecision:'rejected'})
})
for(const [code,reason,status,end] of [['Z14','Z96','A76',null],['Z15','Z24','A74','E37'],['Z18','S17',null,'E37']] as const)it(`persisted positive ${code}/${reason}/${end}`,async()=>{
 await run(message(code,reason,status,end));expect(state.message.validation_report).toMatchObject({applicationDecision:'accepted',prodatProcessingDisposition:{kind:'continue'}})
 expect(state.drafts.filter(d=>d.messageFamily==='APERAK')).toEqual([])
 // Z14/Z15 positives need the native permission effect, which the declared
 // unit port does not apply; Z18 keeps the full96A dual-reference hold.
 if(code==='Z18')expect(state.events.some(e=>String(e.message).includes('UNSM_MESSAGE_STRUCTURE_INVALID'))).toBe(true)
 else expect(state.events.some(e=>String(e.message).includes('inväntar granskning'))).toBe(true)
})
it('false322/324 remains accepted through stored response and raw evidence',async()=>{
 const body=object('Z13'),refs=body.findIndex(segment=>segment[0]==='RFF')
 const m=message('Z13','S17',null,null,alphabets[0],[...body.slice(0,refs),...characteristic('Z23','X99'),...characteristic('Z25','X99'),...body.slice(refs)]);await run(m)
 expect(state.message.raw_payload).toBe(m.raw_payload);expect(state.message.validation_report).toMatchObject({applicationDecision:'accepted',prodatProcessingDisposition:{kind:'continue'}})
 expect(state.drafts.map(d=>d.rawPayload).join('')).toContain('ERC+100::260')
})
it('oversize status is rejected by actual directory before application ACK and business',async()=>{
 const m=message('Z15','S17','X99','X'.repeat(80));await run(m)
 expect(state.message.raw_payload).toBe(m.raw_payload)
 expect(state.message.validation_report).toMatchObject({applicationDecision:'not_applicable',responsePlan:[{family:'CONTRL',outcome:'negative'}]})
 expect(state.drafts.filter(d=>d.messageFamily==='APERAK')).toEqual([])
 expect(state.effects).not.toContain('business');expect(state.effects).not.toContain('facility');expect(state.effects).not.toContain('z14')
 expect(JSON.stringify(state.message.validation_report)).toContain('UNSM_ELEMENT_LENGTH_INVALID')
})

it('missing prospective canonical receipt denies application ACK and business while retaining separate syntax ACK',async()=>{
 state.sourceReceiptFailure=true
 await expect(run(message('Z14','Z96','A76',null))).rejects.toThrow('prodat_canonical_source_validation_unconfirmed')
 expect(state.drafts).toHaveLength(1)
 expect(state.drafts[0]).toMatchObject({messageFamily:'CONTRL'})
 expect(state.drafts[0].rawPayload).not.toContain('ERC+')
 expect(state.effects).toEqual([])
})
