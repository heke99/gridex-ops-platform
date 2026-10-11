// masterplan: SC-029
import {expectOwnReferencePair} from './helpers/p16bHold'
import {guideOrderedFixtureRaw as raw} from './helpers/prodatGuideOrderedFixture'
import {beforeEach,it,expect,vi} from 'vitest'
import {line,qty,common,characteristic,type Parts} from './fixtures/prodat-register'
import {source,z10,head,own} from './fixtures/prodat-identity'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
const state=vi.hoisted(()=>({message:{} as EdielMessageRow, effects:[] as string[], drafts:[] as Record<string,unknown>[], events:[] as Record<string,unknown>[], inject:false,registryFailure:false,realRegisterConsumer:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async importOriginal=>({...await importOriginal<Record<string,unknown>>(),resolveCanonicalRulePack:async()=>{if(state.registryFailure)throw Error('Injected registry failure');return (await import('./helpers/prodatInboundSourceFixture')).prodatFixtureRegistryResolution}}))
vi.mock('@/lib/ediel/rulebook/canonicalPolicyFieldValidator',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/ediel/rulebook/canonicalPolicyFieldValidator')>()
 return {...actual,validateCanonicalPolicyFields:(input:Parameters<typeof actual.validateCanonicalPolicyFields>[0])=>[...actual.validateCanonicalPolicyFields(input),...(state.inject && input.policy.family==='PRODAT' ?[{severity:'error',blocking:true,code:'FIELD_MATRIX_REQUIRED_FIELD_MISSING',title:'Injected metadata loss',description:'Invariant test: owner failed to retain typed source identity'} as EdielRulebookIssue]:[])]}
})
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'fixture@example.invalid',host:'smtp.example.invalid',port:465})}))
vi.mock('@/lib/supabase/service',async()=>({supabaseService:(await import('./helpers/prodatInboundSourceFixture')).prodatFixtureSourceDatabase}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>state.message,createEdielMessageEvent:async(p:Record<string,unknown>)=>{state.events.push(p)},updateEdielMessageStatus:async(p:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{state.message={...state.message,status:p.status,parsed_payload:p.parsedPayload??state.message.parsed_payload,validation_report:p.validationReport??state.message.validation_report} as EdielMessageRow;return state.message},linkEdielMessage:async()=>{state.effects.push('link')},listAckMessagesForSource:async()=>[],getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[]}))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:async()=>({status:'tenant_resolved',companyId:state.message.company_id,message:state.message,evidence:{companyId:state.message.company_id}})}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:async(p:{ackFamily:string;sourceMessage:EdielMessageRow;draft:Record<string,unknown>})=>{state.drafts.push(p.draft);return (await import('./helpers/prodatInboundSourceFixture')).prodatFixtureAckResult(p)}}))
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
import {withProdatFixtureInsertContext} from './helpers/prodatInboundSourceFixture'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
beforeEach(()=>{state.message={...source(raw(z10(),'Z10'),'Z10'),status:'received',company_id:'tenant',parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow;state.effects=[];state.drafts=[];state.events=[];state.inject=false;state.registryFailure=false;state.realRegisterConsumer=false})
const run=()=>{state.message=withProdatFixtureInsertContext(state.message);return processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000002',edielMessageId:state.message.id})}
const retainedErrors=()=> (state.message.validation_report.responsePlan as {applicationErrors?:Record<string,unknown>[]}[]).flatMap(plan=>plan.applicationErrors??[])
function expectHeldOwnField(field:string,reference:string,erc:string){
 expect(retainedErrors()).toContainEqual(expect.objectContaining({fieldCode:field,ercCode:erc,referenceNumber:reference,
  prodatFieldDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field})}))
 expect(state.drafts.length).toBeGreaterThan(0)
 expect(state.drafts.every(d=>d.messageFamily==='CONTRL')).toBe(true)
 expect(state.events.some(event=>String(event.message).includes('APERAK_PRODAT_OBJECT_OUTCOME_MISSING'))).toBe(true)
 expect(state.drafts.map(d=>d.rawPayload).join('')).not.toContain('ERC+')
 expect(state.effects).toEqual([])
}
const z04TwoObjects=():Parts[]=>[
 ...head(),
 line('1','735123456789012345','1','9'),qty('10'),...common('735123456789012345','A'),
 ...characteristic('Z07','Z12'),...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
 ['NAD','IT',['735123456789012345','','9'],'','Installation','Street','City','','12345','SE'],
 ['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'],
 line('2','735123456789012345','2','9'),qty('20'),
 line('3','735123456789012352',undefined,'9'),qty('30'),...common('735123456789012352','B'),
 ...characteristic('Z07','Z12'),...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
 ['NAD','IT',['735123456789012352','','9'],'','Installation','Street','City','','12345','SE'],
 ['NAD','Z02',['54321','160','SVK'],'','','','','','','SE'],
]
it('retains own Z04 quantity diagnosis and holds BGM34 when the sibling has no committed outcome',async()=>{
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
 expectHeldOwnField('213','735123456789012345','41')
})
it('keeps separate field 213 errors for two malformed physical Z04 objects',()=>{
 const parts=z04TwoObjects()
 for(const number of ['2','3'])parts.splice(parts.findIndex(part=>part[0]==='LIN'&&part[1]===number)+1,1)
 const decision=resolveCanonicalRuntimeDecision(source(raw(parts,'Z04'),'Z04'))
 expect(decision.responsePlan.find(plan=>plan.family==='APERAK')?.applicationErrors?.map(error=>[error.fieldCode,error.referenceNumber])).toEqual([
  ['213','735123456789012345'],['213','735123456789012352'],
 ])
})
it('retains invalid own field209 agency without granting an unprocessed sibling an ACK outcome',async()=>{
 const parts=z04TwoObjects()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='3')
 parts[second]=line('3','735123456789012352',undefined,'999')
 state.realRegisterConsumer=true
 state.message={...state.message,...source(raw(parts,'Z04'),'Z04')}
 const decision=resolveCanonicalRuntimeDecision(state.message)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 expect(decision.responsePlan.find(plan=>plan.family==='APERAK')).toMatchObject({outcome:'negative',applicationErrors:[{fieldCode:'209'}]})
 await run()
 expectHeldOwnField('209','735123456789012352','42')
})
it('does not accept QTY+136 as the required own QTY+31 field 213',async()=>{
 const parts=z04TwoObjects()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts[second+1]=['QTY',['136','20','KWH']]
 state.realRegisterConsumer=true
 state.message={...state.message,...source(raw(parts,'Z04'),'Z04')}
 const decision=resolveCanonicalRuntimeDecision(state.message)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 expect(decision.responsePlan.find(plan=>plan.family==='APERAK')).toMatchObject({outcome:'negative',applicationErrors:[{fieldCode:'213'}]})
 await run()
 expectHeldOwnField('213','735123456789012345','41')
})
it('rejects an explicitly gas volume unit on the electricity PRODAT field 213',async()=>{
 const parts=z04TwoObjects()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts[second+1]=['QTY',['31','20','MTQ']]
 state.realRegisterConsumer=true
 state.message={...state.message,...source(raw(parts,'Z04'),'Z04')}
 const decision=resolveCanonicalRuntimeDecision(state.message)
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected'})
 expect(decision.responsePlan.find(plan=>plan.family==='APERAK')).toMatchObject({outcome:'negative',applicationErrors:[{fieldCode:'213'}]})
 await run()
 expectHeldOwnField('213','735123456789012345','42')
})
it('keeps the electricity QTY+31 without an optional unit eligible for the existing positive path',()=>{
 const parts=z04TwoObjects()
 const second=parts.findIndex(part=>part[0]==='LIN'&&part[1]==='2')
 parts[second+1]=['QTY',['31','20']]
 const decision=resolveCanonicalRuntimeDecision(source(raw(parts,'Z04'),'Z04'))
 expect(decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted'})
 expect(decision.responsePlan.find(plan=>plan.family==='APERAK')).toMatchObject({outcome:'positive'})
})
for(const [name,invalid,field] of [
 ['global LIN',z10().map(item=>item[0]==='LIN'?['LIN','2',...item.slice(2)]:item),'314'],
 ['object register',(()=>{const rows=z10();const i=rows.findIndex(item=>item[0]==='LIN');rows[i]=['LIN','1','',['735123456789012345','','','9'],['1','1']];rows.push(['LIN','2','',['735123456789012345','','','9'],['1','1']]);return rows})(),'258'],
] as const)it(`retains malformed ${name} diagnosis while the real source-qualified case writer holds`,async()=>{
 state.realRegisterConsumer=true
 state.message={...state.message,...source(raw(invalid,'Z10'),'Z10')}
 const decision=resolveCanonicalRuntimeDecision(state.message)
 expect(decision).toMatchObject({applicationDecision:'rejected',prodatRegisterValidation:{objects:[{disposition:'rejected'}]}})
 expect(decision.responsePlan).toContainEqual(expect.objectContaining({family:'APERAK',outcome:'negative'}))
 await expect(run()).rejects.toThrow('structural_apply_complete_own_application_required')
 expect(state.message.validation_report).toMatchObject({applicationDecision:'rejected'})
 expect(retainedErrors()).toContainEqual(expect.objectContaining({fieldCode:field,ercCode:'42'}))
 const wire=state.drafts.map(d=>d.rawPayload).join('')
 expect(wire).not.toContain('ERC+100::260')
 // P16B resolved: field 314's own ERC renders with Z07+LI; others stay unqualified.
 if(field==='314')expectOwnReferencePair(state.drafts.filter(d=>d.messageFamily==='APERAK').map(d=>String(d.rawPayload)))
 else{expect(state.drafts.filter(d=>d.messageFamily==='APERAK')).toEqual([]);expect(state.events.some(event=>String(event.message).includes('aperak_prodat_requested_scope_unqualified'))).toBe(true)}
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
it('persists U and stages structural review without granting a market write or an own positive receipt',async()=>{
 await run();expect(state.message.validation_report.prodatProcessingDisposition).toMatchObject({kind:'continue'});expect(state.effects).toEqual(['actor-auto','case'])
 expect(state.drafts.map(d=>d.rawPayload).join('')).not.toContain('ERC+100::260')
 expect(state.events.some(e=>(e.payload as Record<string,unknown>)?.reviewRequired===true)).toBe(true)
})
it('holds only the message with missing owner metadata before actor auto-send/business and suppresses positive fallback',async()=>{
 state.inject=true;await run();expect(state.effects).toEqual([]);expect(state.message.validation_report).toMatchObject({applicationDecision:'manual_review',functionalDecision:'not_applicable',prodatProcessingDisposition:{kind:'internal_review'}})
 expect(state.drafts.length).toBeGreaterThan(0);expect(state.drafts.every(d=>d.messageFamily==='CONTRL')).toBe(true);expect(state.drafts.map(d=>d.rawPayload).join('')).not.toContain('ERC+')
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

it('internal review retains own special109 with both Z09D dates while full96A holds dual-reference wire',async()=>{
 const body=[...head(),...own('1','735123456789012345','CASE')].map(p=>p[0]==='CAV'?['CAV','Z70']:p);
 body.splice(4,0,['DTM',['93','202611010000','203']]);
 state.message={...state.message,...source(raw(body,'Z09'),'Z09')};state.inject=true;await run();
 expect(state.effects).toEqual([]);expect(state.message.validation_report.prodatProcessingDisposition).toMatchObject({kind:'internal_review'});
 expect(retainedErrors()).toContainEqual(expect.objectContaining({ercCode:'40',fieldCode:'109'}))
 expectOwnReferencePair(state.drafts.filter(d=>d.messageFamily==='APERAK').map(d=>String(d.rawPayload))) // P16B resolved
 expect(state.drafts.map(d=>d.rawPayload).join('')).toContain('ERC+40::260')
 expect(state.drafts.map(d=>d.rawPayload).join('')).not.toContain('ERC+100::260')
})
