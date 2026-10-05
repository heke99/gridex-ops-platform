import {beforeEach,it,expect,vi} from 'vitest'
import type {Parts} from './fixtures/prodat-register'
import {guideOrderedFixtureRaw as raw} from './helpers/prodatGuideOrderedFixture'
import {permissionMessage} from './fixtures/prodat-energy-product'
import {source,z10,head,own} from './fixtures/prodat-identity'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
const state=vi.hoisted(()=>({message:{} as EdielMessageRow, effects:[] as string[], drafts:[] as Record<string,unknown>[], events:[] as Record<string,unknown>[], inject:false,registryFailure:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async original=>({...await original<Record<string,unknown>>(),resolveCanonicalRulePack:async()=>{if(state.registryFailure)throw Error('Injected registry failure');return (await import('./helpers/prodatInboundSourceFixture')).prodatFixtureRegistryResolution}}))
vi.mock('@/lib/ediel/rulebook/canonicalPolicyFieldValidator',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/ediel/rulebook/canonicalPolicyFieldValidator')>()
 return {...actual,validateCanonicalPolicyFields:(input:Parameters<typeof actual.validateCanonicalPolicyFields>[0])=>[...actual.validateCanonicalPolicyFields(input),...(state.inject && input.policy.family==='PRODAT' ?[{severity:'error',blocking:true,code:'FIELD_MATRIX_REQUIRED_FIELD_MISSING',title:'Injected metadata loss',description:'Invariant test: owner failed to retain typed source identity'} as EdielRulebookIssue]:[])]}
})
vi.mock('@/lib/ediel/mailReadiness',()=>({assertEdielSmtpReadiness:()=>({from:'fixture@example.invalid',host:'smtp.example.invalid',port:465})}))
vi.mock('@/lib/supabase/service',async()=>({supabaseService:(await import('./helpers/prodatInboundSourceFixture')).prodatFixtureSourceDatabase}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>state.message,createEdielMessageEvent:async(p:Record<string,unknown>)=>{state.events.push(p)},updateEdielMessageStatus:async(p:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{state.message={...state.message,status:p.status,parsed_payload:p.parsedPayload??state.message.parsed_payload,validation_report:p.validationReport??state.message.validation_report} as EdielMessageRow;return state.message},linkEdielMessage:async()=>{state.effects.push('link')},listAckMessagesForSource:async()=>[],getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[]}))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:async()=>({status:'tenant_resolved',message:state.message,companyId:state.message.company_id,evidence:{companyId:state.message.company_id}})}))
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
import {withProdatFixtureInsertContext} from './helpers/prodatInboundSourceFixture'
beforeEach(()=>{state.message={...source(raw(z10(),'Z10'),'Z10'),status:'received',company_id:'tenant',parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow;state.effects=[];state.drafts=[];state.events=[];state.inject=false;state.registryFailure=false})
const run=()=>{state.message=withProdatFixtureInsertContext(state.message);return processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000002',edielMessageId:state.message.id})}

for(const mixed of [false,true])it(`persists exact unready F and holds effects, mixed=${mixed}`,async()=>{
 const body:Parts[]=[...head(),...own('1','735123456789012345',null)].filter(p=>p[0]!=='RFF'||!(p[1] as string[]).includes('ANJ')).map(p=>p[0]==='NAD'&&p[1]==='UD'?['NAD','UD',['X'.repeat(35),'','89'],'','Synthetic','Street','City','','12345','SE']:p);
 if(mixed){const index=body.findIndex(p=>p[0]==='DTM');body[index]=['DTM',['92','202610010000','BAD']];}
 state.message={...state.message,...source(raw(body,'Z01'),'Z01'),parsed_payload:{fileEngine:{mode:'agt'}}};await run();
 expect(state.effects).toEqual([]);
 expect(state.message.validation_report).toMatchObject({applicationDecision:'rejected',functionalDecision:'manual_review',prodatProcessingDisposition:{kind:'internal_review'}});
 const wire=state.drafts.map(d=>d.rawPayload).join('');
 expect(wire).not.toContain('ERC+100::260');expect(wire).not.toContain('FTX+AAO++261::260');
 expect(wire).toContain('FTX+AAO++226::260');
 if(mixed)expect(wire).toContain('FTX+AAO++210::260');
 expect(JSON.stringify(state.message.validation_report)).toContain('XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
})

it('actual directory rejects oversize506 before application diagnosis while preserving original bytes',async()=>{
 state.message={...state.message,...permissionMessage('Z14','S17','X'.repeat(36)),parsed_payload:{fileEngine:{mode:'agt'}}};await run();
 expect(state.effects).toEqual([]);expect(state.message.validation_report).toMatchObject({applicationDecision:'not_applicable',functionalDecision:'not_applicable',responsePlan:[{family:'CONTRL',outcome:'negative'}]});
 expect(state.drafts.length).toBeGreaterThan(0);expect(state.drafts.every(d=>d.messageFamily==='CONTRL')).toBe(true);
 expect(state.message.raw_payload).toContain('X'.repeat(36))
 expect(JSON.stringify(state.message.validation_report)).toContain('UNSM_ELEMENT_LENGTH_INVALID')
 expect(state.drafts[0].rawPayload).not.toContain('ERC+')
})
it('representable F retains its own negative without granting market effects',async()=>{
 state.message={...state.message,...source(raw([...head(),...own('1','735123456789012345',null)],'Z01'),'Z01'),parsed_payload:{fileEngine:{mode:'agt'}}};await run();
 expect(state.message.validation_report).toMatchObject({applicationDecision:'rejected',functionalDecision:'accepted',prodatProcessingDisposition:{kind:'continue'}});
 expect(state.effects).toEqual(['actor-auto']);
 const wire=state.drafts.map(d=>d.rawPayload).join('');expect(wire).toContain('Ärendereferens saknas, kundid=001');expect(wire).not.toContain('ERC+100::260');
})
