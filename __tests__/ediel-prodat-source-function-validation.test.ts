import {describe,it,expect,vi} from 'vitest'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:io}))
import {recordReceivedSourceValidation,takeReceivedSourceOwnerSeed} from '@/lib/ediel/core/receivedSourceValidationLedger'
import {deathRaw,deathBody,deathSelection} from './fixtures/prodat-death-status'
import {characteristic,raw,line,common} from './fixtures/prodat-register'
import {source} from './fixtures/prodat-identity'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {evaluateProdatDeathStatus} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import {projectProdatRegisterValidation} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import {bindDeathStatusSourceContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {bindReceivedProdatSourceFunction,projectProdatSourceFunctionObjects} from '@/lib/ediel/prodat/prodatSourceFunctionValidation'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/ediel/rulebook/canonicalRulePackRegistry')>(),rulePackId='00000000-0000-4000-8000-000000000012',messageProfileId='00000000-0000-4000-8000-000000000011',profileKey='PRODAT:Z06:E:26.A:r3',sourceHash='a'.repeat(64)
 return {...actual,resolveCanonicalRulePack:async()=>({profileKey:'prodat_z06_customer_update',databaseProfileKey:profileKey,sourceHash,messageProfileId,rulePackId,originalVersion:'26.A:r3',originalSnapshot:{rulePack:{id:rulePackId,guide_version:'26.A',guide_revision:'3',source_hash:sourceHash},messageProfile:{id:messageProfileId,rule_pack_id:rulePackId,profile_key:profileKey},guideSources:[]}})}
})
import {resolveCanonicalRuntimeDecisionWithRegistry,readReceivedCanonicalProdatSourceFunction,hasReceivedCanonicalProdatPartialOwner} from '@/lib/ediel/core/runtimeDecision'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
function fixture(){
 const raw=deathRaw('Z06',[...deathBody('E34',characteristic('Z17','Z41')),...deathBody('E34',[],'B','2')]),selection=deathSelection(),wire=tokenizeEdifact(raw)
 const context=bindDeathStatusSourceContext({kind:'customer_life_event',direction:'inbound',code:'Z06',companyId:'00000000-0000-4000-8000-000000000002',environment:'test',sourceMessageId:'00000000-0000-4000-8000-000000000001',sourceContextReceiptId:'00000000-0000-4000-8000-000000000099',sourceContextFactsHash:'c'.repeat(64),rawPayload:raw,sourceEventId:'declared-synthetic-event',sourceRevision:'2',sourceDigest:evidenceHash(raw),businessContext:'death',bilateralCapabilityVerified:false,selection})
 const evaluated=evaluateProdatDeathStatus({code:'Z06',rawSegments:wire.segments.map(t=>t.raw),una:wire.una,direction:'inbound',facts:{deathStatus:context.selection}})
 const register=projectProdatRegisterValidation({code:'Z06',rawSegments:wire.segments.map(t=>t.raw),una:wire.una,registerIssues:[],fieldIssues:[],completeRuleSelection:true,handledFields:new Set()})
 return {raw,wire,context,evaluated,register}
}
describe('same existing E310 source-function partition',()=>{
 it('preserves a genuinely classified own object and holds unknown sibling without national inference',()=>{
  const f=fixture(),facet=projectProdatSourceFunctionObjects({register:f.register,conditions:f.evaluated.objectConditions,context:f.context})!
  expect(f.evaluated.objectConditions.map(o=>o.sourceDecision)).toEqual(['accepted','held'])
  expect(facet.objects.map(o=>[o.objectId,o.functionalDecision])).toEqual([['A','accepted'],['B','held']])
  expect(bindReceivedProdatSourceFunction(facet,f.raw)).toEqual(facet)
  expect(f.evaluated.issues.some(i=>i.code==='PRODAT_DEATH_STATUS_REQUIRED')).toBe(false)
 })
 it('cannot use cloned context, foreign source digest or omitted/duplicate physical scope',()=>{
  const f=fixture()
  expect(projectProdatSourceFunctionObjects({register:f.register,conditions:f.evaluated.objectConditions,context:structuredClone(f.context)})).toBeNull()
  const facet=projectProdatSourceFunctionObjects({register:f.register,conditions:f.evaluated.objectConditions,context:f.context})!
  for(const bad of [{...facet,objects:[facet.objects[0]]},{...facet,objects:[facet.objects[0],facet.objects[0]]},{...facet,sourcePayloadHash:'d'.repeat(64)},{...facet,businessAccepted:true}])expect(bindReceivedProdatSourceFunction(bad,f.raw)).toBeNull()
 })
 it('does not borrow a source condition into a sibling tuple, message or later register',()=>{
  const f=fixture(),conditions=f.evaluated.objectConditions.map(o=>({...o,firstLineIndex:o.firstLineIndex+1}))
  expect(projectProdatSourceFunctionObjects({register:f.register,conditions,context:f.context})!.objects.every(o=>o.functionalDecision==='held')).toBe(true)
 })
 it('actual WithRegistry marks only its unchanged source/function object; copies and changed scope are unowned',async()=>{
  const f=fixture(),message={...source(f.raw,'Z06'),company_id:f.context.companyId},decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{deathStatusContext:f.context})
  const facet=readReceivedCanonicalProdatSourceFunction(decision,message)
  expect(facet?.objects.map(o=>o.functionalDecision)).toEqual(['accepted','held'])
  expect(readReceivedCanonicalProdatSourceFunction(structuredClone(decision),message)).toBeNull()
  expect(readReceivedCanonicalProdatSourceFunction(decision,{...message,company_id:null})).toBeNull()
  // This compact E fixture deliberately omits other mandatory fields: owning
  // source facts cannot bypass the full application/header owner.
  expect(hasReceivedCanonicalProdatPartialOwner(decision,message)).toBe(false)
  decision.responsePlan=[]
  expect(readReceivedCanonicalProdatSourceFunction(decision,message)).toBeNull()
 })
 it('does not turn a declared source fact into received evidence without genuine birth context',async()=>{
  const f=fixture(),message={...source(f.raw,'Z06'),company_id:f.context.companyId},decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{deathStatusContext:f.context})
  expect(buildReceivedSourceValidationEvidence({original:message,validated:message,resolvedCompanyId:message.company_id,decision})).toBeNull()
 })
})

function validExample(){
 const own=(id:string,seq:string)=>{const original=common(seq,'Synthetic').map(p=>p[0]==='DTM'&&Array.isArray(p[1])&&p[1][0]==='92'?['DTM',['157','202610010000','203']]:p[0]==='CAV'&&Array.isArray(p[1])&&p[1][0]==='Z22'?['CAV','E34']:p);return [line(seq,id,undefined,'9'),...original.filter(p=>p[0]==='DTM'),...characteristic('Z17','Z41'),...characteristic('Z12','D',3),...original.filter(p=>p[0]!=='DTM'),['NAD','IT',[id,'','9'],'','','Street','City','','12345','SE'],['NAD','Z02',['11111','160','SVK']]]}
 const rawPayload=raw([['NAD','FR',['12345','160','SVK'],'','','','','','','SE'],['NAD','DO',['54321','160','SVK'],'','','','','','','SE'],...own('735123456789012345','1'),...own('735123456789012346','2')] as Parameters<typeof raw>[0],'Z06').replace('+S+R+','+12345:14+54321:14+')
 const selection=deathSelection(),fact=selection.objects[0]
 fact.installation={id:'735123456789012345',agency:'9'};fact.customer={...fact.customer,id:'CUSTOMER-1'};fact.lineItemReference='CASE-1';fact.legalGridOwner={id:'12345',qualifier:'160',agency:'SVK'};fact.legalSupplier={id:'54321',qualifier:'160',agency:'SVK'}
 const message={...source(rawPayload,'Z06'),company_id:'00000000-0000-4000-8000-000000000002'}
 const context=bindDeathStatusSourceContext({kind:'customer_life_event',direction:'inbound',code:'Z06',companyId:message.company_id,environment:'test',sourceMessageId:message.id,sourceContextReceiptId:'00000000-0000-4000-8000-000000000099',sourceContextFactsHash:'c'.repeat(64),rawPayload,sourceEventId:'declared-synthetic-event',sourceRevision:'2',sourceDigest:evidenceHash(rawPayload),businessContext:'death',bilateralCapabilityVerified:false,selection})
 return {message,context}
}
it('valid complete own E source can continue while a source-unclassified sibling stays held',async()=>{
 const {message,context}=validExample(),decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{deathStatusContext:context})
 expect(decision.functionalDecision).toBe('manual_review')
 expect(decision.applicationDecision).toBe('accepted');expect(decision.functionalDecision).toBe('manual_review');expect(decision.prodatProcessingDisposition?.kind).toBe('internal_review')
 expect(hasReceivedCanonicalProdatPartialOwner(decision,message),JSON.stringify({application:decision.prodatApplicationValidation,functions:readReceivedCanonicalProdatSourceFunction(decision,message),issues:decision.issues.map(i=>[i.code,i.description])})).toBe(true)
 expect(readReceivedCanonicalProdatSourceFunction(decision,message)?.objects.map(o=>o.functionalDecision)).toEqual(['accepted','held'])
})

it('same opaque function and all own object/application/response facets append through V6, hashes checked before a one-use seed',async()=>{
 const {message,context}=validExample()
 message.execution_context_snapshot={receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:message.id,companyId:message.company_id,environment:message.environment,messageCode:'Z06',payloadHash:evidenceHash(message.raw_payload!),sourceReceivedAt:message.message_received_at,capturedAt:message.message_received_at}}
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message,{deathStatusContext:context})
 io.rpc.mockImplementation((name:string,args:Record<string,string>)=>({abortSignal:async()=>{
  expect(name).toBe('gridex_record_prodat_source_validation_v6')
  expect(JSON.parse(args.p_source_function_facts_text).objects.map((o:{functionalDecision:string})=>o.functionalDecision)).toEqual(['accepted','held'])
  return {data:{version:6,companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,factsHash:evidenceHash(args.p_facts_text),sourceDisposition:'not_established',assessmentId:'00000000-0000-4000-8000-000000000077',objectFactsHash:args.p_object_facts_text?evidenceHash(args.p_object_facts_text):null,applicationFactsHash:args.p_application_facts_text?evidenceHash(args.p_application_facts_text):null,responseFactsHash:args.p_response_facts_text?evidenceHash(args.p_response_facts_text):null,ignoredFieldsHash:args.p_ignored_fields_text?evidenceHash(args.p_ignored_fields_text):null,sourceFunctionFactsHash:evidenceHash(args.p_source_function_facts_text)},error:null}
 }}))
 const receipt=await recordReceivedSourceValidation({original:message,validated:message,resolvedCompanyId:message.company_id,decision})
 expect(receipt.status).toBe('recorded')
 expect(takeReceivedSourceOwnerSeed(receipt)?.evidence.prodatSourceFunctionValidation?.objects.map(o=>o.functionalDecision)).toEqual(['accepted','held'])
 expect(takeReceivedSourceOwnerSeed(receipt)).toBeNull()
})
