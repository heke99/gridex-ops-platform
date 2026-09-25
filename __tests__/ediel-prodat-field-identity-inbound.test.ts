import {beforeEach,it,expect,vi} from 'vitest'
import {raw,line,qty,common,characteristic,type Parts} from './fixtures/prodat-register'
import {source,z10,head,own} from './fixtures/prodat-identity'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
const state=vi.hoisted(()=>({message:{} as EdielMessageRow, effects:[] as string[], drafts:[] as Record<string,unknown>[], events:[] as Record<string,unknown>[], inject:false,registryFailure:false,realRegisterConsumer:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:async()=>{if(state.registryFailure)throw Error('Injected registry failure');return {profileKey:'synthetic',sourceHash:'evidence',messageProfileId:'profile',rulePackId:'pack'}}}))
vi.mock('@/lib/ediel/rulebook/canonicalPolicyFieldValidator',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/ediel/rulebook/canonicalPolicyFieldValidator')>()
 return {...actual,validateCanonicalPolicyFields:(input:Parameters<typeof actual.validateCanonicalPolicyFields>[0])=>[...actual.validateCanonicalPolicyFields(input),...(state.inject && input.policy.family==='PRODAT' ?[{severity:'error',blocking:true,code:'FIELD_MATRIX_REQUIRED_FIELD_MISSING',title:'Injected metadata loss',description:'Invariant test: owner failed to retain typed source identity'} as EdielRulebookIssue]:[])]}
})
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('UNEXPECTED_DB')}}}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>state.message,createEdielMessageEvent:async(p:Record<string,unknown>)=>{state.events.push(p)},updateEdielMessageStatus:async(p:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{state.message={...state.message,status:p.status,parsed_payload:p.parsedPayload??state.message.parsed_payload,validation_report:p.validationReport??state.message.validation_report} as EdielMessageRow;return state.message},linkEdielMessage:async()=>{state.effects.push('link')},listAckMessagesForSource:async()=>[],getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[]}))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:async()=>({status:'tenant_resolved',message:state.message,evidence:{companyId:'tenant'}})}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:async(p:{ackFamily:string;draft:Record<string,unknown>})=>{state.drafts.push(p.draft);return {id:p.ackFamily,status:'sent'}}}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>{state.effects.push('actor-auto');return null}}))
vi.mock('@/lib/ediel/inbound/inboundFacilityRecognition',()=>({recognizeInboundFacilityData:async()=>{state.effects.push('facility');return null}}))
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointForEdielMessage:async()=>null,matchSiteAndCustomerForMeteringPoint:async()=>null,findMatchingSupplierSwitchRequest:async()=>null}))
vi.mock('@/lib/ediel/inboundCases',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/ediel/inboundCases')>()
 return {...actual,createOrUpdateInboundProdatCase:async(input:Parameters<typeof actual.createOrUpdateInboundProdatCase>[0])=>{
  if(state.realRegisterConsumer)return actual.createOrUpdateInboundProdatCase(input)
  state.effects.push('case');return null
 }}
})
vi.mock('@/lib/onboarding/inboundEdielLinking',()=>({applyInboundProdatZ02ToCustomerInfoRequest:async()=>{state.effects.push('z02');return null},applyInboundProdatZ14ToMeteringPermission:async()=>{state.effects.push('z14');return null}}))
vi.mock('@/lib/ediel/flows/inboundBusinessStateMachine',()=>({applyInboundBusinessStateMachine:async()=>{state.effects.push('business');return null}}))
vi.mock('@/lib/ediel/operationalVerification',()=>({buildSafeMasterdataProposal:async()=>[{field:'synthetic',reviewRequired:true}]}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:async()=>null}))
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
beforeEach(()=>{state.message={...source(raw(z10(),'Z10'),'Z10'),status:'received',company_id:'tenant',parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow;state.effects=[];state.drafts=[];state.events=[];state.inject=false;state.registryFailure=false;state.realRegisterConsumer=false})
const run=()=>processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000002',edielMessageId:state.message.id})
const z04TwoObjects=():Parts[]=>[
 ...head(),
 line('1','735123456789012345','1','9'),qty('10'),...common('735123456789012345','A'),
 ...characteristic('Z07','E22'),...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
 ['NAD','IT',['735123456789012345','','9'],'','Installation','Street','City','','12345','SE'],
 ['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'],
 line('2','735123456789012345','2','9'),qty('20'),
 line('3','735123456789012352',undefined,'9'),qty('30'),...common('735123456789012352','B'),
 ...characteristic('Z07','E22'),...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
 ['NAD','IT',['735123456789012352','','9'],'','Installation','Street','City','','12345','SE'],
 ['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'],
]
it('ACKs only the malformed own Z04 quantity in a guide-valid two-object original before the real case writer',async()=>{
 const control=source(raw(z04TwoObjects(),'Z04'),'Z04')
 expect(resolveCanonicalRuntimeDecision(control)).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted'})
 const parts=z04TwoObjects(), second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts.splice(second+1,1)
 state.realRegisterConsumer=true
 state.message={...state.message,...source(raw(parts,'Z04'),'Z04')}
 const decision=resolveCanonicalRuntimeDecision(state.message)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected',prodatRegisterValidation:{objects:[{objectId:'735123456789012345',disposition:'rejected'},{objectId:'735123456789012352',disposition:'unavailable'}]}})
 expect(decision.responsePlan.find(plan=>plan.family==='APERAK')).toMatchObject({outcome:'negative',applicationErrors:[{fieldCode:'213'}]})
 await run()
 expect(state.message.validation_report).toMatchObject({applicationDecision:'rejected'})
 expect(state.drafts.map(d=>d.messageFamily)).toEqual(['CONTRL','APERAK'])
 const wire=state.drafts.map(d=>d.rawPayload).join('')
 expect(wire).toContain('FTX+AAO++213::260')
 expect(wire).toContain('RFF+Z07:735123456789012345')
 expect(wire).not.toContain('RFF+Z07:735123456789012352')
 expect(wire).not.toContain('ERC+100::260')
 expect(state.effects).toEqual([])
})
it('keeps separate field 213 errors for two malformed physical Z04 objects',()=>{
 const parts=z04TwoObjects()
 for(const number of ['2','3'])parts.splice(parts.findIndex(part=>part[0]==='LIN'&&part[1]===number)+1,1)
 const decision=resolveCanonicalRuntimeDecision(source(raw(parts,'Z04'),'Z04'))
 expect(decision.responsePlan.find(plan=>plan.family==='APERAK')?.applicationErrors?.map(error=>[error.fieldCode,error.referenceNumber])).toEqual([
  ['213','735123456789012345'],['213','735123456789012352'],
 ])
})
for(const [name,invalid,field] of [
 ['global LIN',z10().map(item=>item[0]==='LIN'?['LIN','2',...item.slice(2)]:item),'314'],
 ['object register',(()=>{const rows=z10();const i=rows.findIndex(item=>item[0]==='LIN');rows[i]=['LIN','1','',['735123456789012345','','','9'],['1','1']];rows.push(['LIN','2','',['735123456789012345','','','9'],['1','1']]);return rows})(),'258'],
] as const)it(`ACKs malformed ${name} before the real inbound case rejects its structure`,async()=>{
 state.realRegisterConsumer=true
 state.message={...state.message,...source(raw(invalid,'Z10'),'Z10')}
 const decision=resolveCanonicalRuntimeDecision(state.message)
 expect(decision).toMatchObject({applicationDecision:'rejected',prodatRegisterValidation:{objects:[{disposition:'rejected'}]}})
 expect(decision.responsePlan).toContainEqual(expect.objectContaining({family:'APERAK',outcome:'negative'}))
 await run()
 expect(state.message.validation_report).toMatchObject({applicationDecision:'rejected'})
 expect(state.drafts.map(d=>d.messageFamily)).toEqual(['CONTRL','APERAK'])
 expect(state.drafts.map(d=>d.rawPayload).join('')).toContain(`FTX+AAO++${field}::260`)
 expect(state.effects).toEqual([])
})
it('holds an own QTY31/213 omission before the case writer without an invented positive response',async()=>{
 state.realRegisterConsumer=true
 const invalid=[...head(),line('1','735123456789012345'),...characteristic('Z13','Z22')]
 state.message={...state.message,...source(raw(invalid,'Z04'),'Z04')}
 const decision=resolveCanonicalRuntimeDecision(state.message)
 expect(decision).toMatchObject({applicationDecision:'rejected',prodatRegisterValidation:{objects:[{disposition:'rejected'}]}})
 await run()
 expect(state.effects).toEqual([])
 const wire=state.drafts.map(d=>d.rawPayload).join('')
 expect(wire).not.toContain('ERC+100::260')
 expect(wire).toContain('FTX+AAO++213::260')
})
it('persists U as diagnostics and continues guarded inbound staging with the prescribed ACK',async()=>{
 await run();expect(state.message.validation_report.prodatProcessingDisposition).toMatchObject({kind:'continue'});expect(state.effects).toEqual(['actor-auto','facility','link','case','z02','z14','business'])
 expect(state.drafts.map(d=>d.rawPayload).join('')).toContain('ERC+100::260');expect(state.events.some(e=>(e.payload as Record<string,unknown>)?.appliedAutomatically===false)).toBe(true)
})
it('holds only the message with missing owner metadata before actor auto-send/business and suppresses positive fallback',async()=>{
 state.inject=true;await run();expect(state.effects).toEqual([]);expect(state.message.validation_report).toMatchObject({applicationDecision:'manual_review',functionalDecision:'not_applicable',prodatProcessingDisposition:{kind:'internal_review'}})
 expect(state.drafts,JSON.stringify(state.events)).toHaveLength(1);expect(state.drafts[0].messageFamily).toBe('CONTRL');expect(state.drafts.map(d=>d.rawPayload).join('')).not.toContain('ERC+')
})
it('retains the real missing226 negative through persistence/draft while a separate invariant holds business',async()=>{
 state.inject=true;state.message.raw_payload=raw(z10(false),'Z10');await run();expect(state.effects).toEqual([]);expect(state.message.validation_report).toMatchObject({applicationDecision:'rejected',functionalDecision:'manual_review'})
 const wire=state.drafts.map(d=>d.rawPayload).join('');expect(wire).toContain('ERC+41::260');expect(wire).toContain('FTX+AAO++226::260');expect(wire).not.toContain('ERC+42::260');expect(wire).not.toContain('ERC+100::260');expect(wire).not.toContain('CACHED-UNRELATED')
})

for(const missing of [false,true])it(`internal review plus registry failure emits only qualified negatives: missing226=${missing}`,async()=>{
 state.inject=true;state.registryFailure=true;if(missing)state.message.raw_payload=raw(z10(false),'Z10');await run();
 expect(state.effects).toEqual([]);expect(state.message.validation_report.prodatProcessingDisposition).toMatchObject({kind:'internal_review'});
 const wire=state.drafts.map(d=>d.rawPayload).join('');
 expect(state.drafts.some(d=>d.messageFamily==='CONTRL')).toBe(true);
 if(missing){expect(wire).toContain('ERC+41::260');expect(wire).toContain('FTX+AAO++226::260')}else{expect(wire).not.toContain('ERC+')}
 expect(wire).not.toContain('ERC+40::260');expect(wire).not.toContain('CACHED-UNRELATED');
})

it('internal review retains qualified special109 with both Z09D dates',async()=>{
 const body=[...head(),...own('1','735123456789012345','CASE')].map(p=>p[0]==='CAV'?['CAV','Z70']:p);
 body.splice(4,0,['DTM',['93','202611010000','203']]);
 state.message={...state.message,...source(raw(body,'Z09'),'Z09')};state.inject=true;await run();
 expect(state.effects).toEqual([]);expect(state.message.validation_report.prodatProcessingDisposition).toMatchObject({kind:'internal_review'});
 const wire=state.drafts.map(d=>d.rawPayload).join('');expect(wire).toContain('ERC+40::260');expect(wire).toContain('FTX+AAO++109::260');expect(wire).not.toContain('ERC+100::260');
})
