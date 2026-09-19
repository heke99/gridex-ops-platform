import {beforeEach,it,expect,vi} from 'vitest'
import {raw} from './fixtures/prodat-register'
import {source,z10} from './fixtures/prodat-identity'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
const state=vi.hoisted(()=>({message:{} as EdielMessageRow, effects:[] as string[], drafts:[] as Record<string,unknown>[], events:[] as Record<string,unknown>[], inject:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:async()=>({profileKey:'synthetic',sourceHash:'evidence',messageProfileId:'profile',rulePackId:'pack'})}))
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
vi.mock('@/lib/ediel/inboundCases',()=>({createOrUpdateInboundProdatCase:async()=>{state.effects.push('case');return null}}))
vi.mock('@/lib/onboarding/inboundEdielLinking',()=>({applyInboundProdatZ02ToCustomerInfoRequest:async()=>{state.effects.push('z02');return null},applyInboundProdatZ14ToMeteringPermission:async()=>{state.effects.push('z14');return null}}))
vi.mock('@/lib/ediel/flows/inboundBusinessStateMachine',()=>({applyInboundBusinessStateMachine:async()=>{state.effects.push('business');return null}}))
vi.mock('@/lib/ediel/operationalVerification',()=>({buildSafeMasterdataProposal:async()=>[{field:'synthetic',reviewRequired:true}]}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:async()=>null}))
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
beforeEach(()=>{state.message={...source(raw(z10(),'Z10'),'Z10'),status:'received',company_id:'tenant',parsed_payload:{fileEngine:{mode:'agt'}}} as EdielMessageRow;state.effects=[];state.drafts=[];state.events=[];state.inject=false})
const run=()=>processInboundEdielMessage({actorUserId:'00000000-0000-4000-8000-000000000002',edielMessageId:state.message.id})
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
