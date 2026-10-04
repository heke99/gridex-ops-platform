import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({registry:vi.fn(),rpc:vi.fn(),capture:vi.fn(),unconfirmed:false,source:null as {raw_payload:string|null}|null}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async()=>({...await vi.importActual<object>('@/lib/ediel/rulebook/canonicalRulePackRegistry'),resolveCanonicalRulePack:io.registry}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/core/sourceRulePackEvidence',()=>({captureFreshEdielSourceRulePackEvidence:io.capture}))
import {initialCanonicalUtiltsDecision,recordFinalCanonicalUtiltsDecision} from '@/lib/ediel/flows/utiltsCanonicalValidation'
import {readCanonicalPeriodicReasonAuthority,readCanonicalUtiltsIssuerIdentityAuthority,type CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {qualifyReceivedUtiltsStructure} from '@/lib/ediel/utilts/qualifyReceivedStructure'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
const company='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',packId='33333333-3333-4333-8333-333333333333',profileId='44444444-4444-4444-8444-444444444444'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
function source(){const message={...energyHandoffMessage('2026-10-01',company),id};message.raw_payload=message.raw_payload!.replaceAll('23-DDQ-E66-T','23-DGI-E66-T').replace('NAD+DDQ','NAD+DGI').replace('STS+7++E88::260','STS+7++E23::260');message.application_reference='23-DGI-E66-T';const original={...message,execution_context_snapshot:{receivedUtiltsContext:{version:1,contextOrigin:'database_insert',sourceMessageId:id,companyId:company,environment:'test',messageCode:'E66',payloadHash:hash(message.raw_payload!),sourceReceivedAt:message.message_received_at,capturedAt:'2026-10-01T20:00:00Z'}}};io.source=original;return original}
beforeEach(()=>{io.unconfirmed=false;io.registry.mockReset();io.rpc.mockReset();io.capture.mockReset();io.capture.mockResolvedValue({status:'captured',evidence:{}})
 io.registry.mockResolvedValue({profileKey:'utilts_e66',databaseProfileKey:'UTILTS:E66:E5SE5A:4',messageProfileId:profileId,rulePackId:packId,sourceHash:'a'.repeat(64),originalVersion:'25-A-4:r4',originalSnapshot:{rulePack:{id:packId,source_hash:'a'.repeat(64),guide_version:'25-A-4',guide_revision:'4'},messageProfile:{id:profileId,rule_pack_id:packId,profile_key:'UTILTS:E66:E5SE5A:4'},guideSources:[{id:'55555555-5555-4555-8555-555555555555',rule_pack_id:packId}]}})
 // Explicit external I/O model only; this fixture neither imports authentic
 // foreign registry/history/retention nor seeds a real issuer approval.
 io.rpc.mockImplementation((name:string,args:Record<string,string>)=>name==='gridex_read_periodic_dgi_e66_reason_v1'?Promise.resolve({error:null,data:{version:1,companyId:company,environment:'test',sourceMessageId:id,sourcePayloadHash:hash(io.source!.raw_payload!),status:'qualified',expectedReasons:[{transactionIndex:0,transactionId:'GRIDEX2607E66001',reasonCode:'E23',receivedReasonCode:'E23',scopeHash:'b'.repeat(64),agreementReviewIds:['99999999-9999-4999-8999-999999999991','99999999-9999-4999-8999-999999999992']}],holdReason:null}}):name==='gridex_read_utilts_issuer_identity_authority_v1'?Promise.resolve({error:null,data:{version:1,companyId:company,environment:'test',sourceMessageId:id,sourcePayloadHash:hash(io.source!.raw_payload!),status:'qualified',authorityVersionId:'88888888-8888-4888-8888-888888888888',namespaceEpoch:'1',messageReferenceCollision:false,transactionReferenceCollisions:[],holdReason:null}}):({abortSignal:async()=>({error:io.unconfirmed ? {message:'fixture unavailable'} : null,data:{version:name==='gridex_record_utilts_source_validation_v4' ? 4 : 1,assessmentId:'66666666-6666-4666-8666-666666666666',companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,sourceDisposition:'not_established',factsHash:hash(args.p_facts_text),transactionFactsHash:args.p_transaction_facts_text ? hash(args.p_transaction_facts_text) : null,headerFactsHash:args.p_header_facts_text ? hash(args.p_header_facts_text) : null,functionalFactsHash:args.p_functional_facts_text ? hash(args.p_functional_facts_text) : null}})}))
})
function runtimeOptions(initial:CanonicalRuntimeDecision,message:EdielMessageRow){const token=readCanonicalUtiltsIssuerIdentityAuthority({decision:initial,message});if(!token||!initial.policy)throw new Error('fixture genuine issuer token missing');const periodic=readCanonicalPeriodicReasonAuthority({decision:initial,message});if(!periodic)throw Error('fixture genuine periodic token missing');return {canonicalPolicy:initial.policy,issuerIdentityAuthority:token,periodicReasonAuthority:periodic}}
describe('periodic source-capability initial/final native-I/O boundary model, NOT native execution',()=>{
 it('reuses the initial actual periodic and issuer tokens across matching and structure without another guide/scope read',async()=>{
  const original=source(),initial=await initialCanonicalUtiltsDecision(original),validated={...original,customer_id:'77777777-7777-4777-8777-777777777777'}
  const qualified=await qualifyReceivedUtiltsStructure({message:validated,...runtimeOptions(initial,validated),runtime:runUtiltsRuntimeForMessage(validated,runtimeOptions(initial,validated))})
  const result=await recordFinalCanonicalUtiltsDecision({original,validated,initialDecision:initial,runtime:qualified.runtime})
  expect(result.receipt.status).toBe('recorded');expect(result.decision.policy).toBe(initial.policy);expect(io.registry).toHaveBeenCalledTimes(1)
  expect(io.rpc.mock.calls.map(([name])=>name)).toEqual(['gridex_read_utilts_issuer_identity_authority_v1','gridex_read_periodic_dgi_e66_reason_v1','gridex_record_utilts_source_validation_v4'])
  expect(JSON.parse(io.rpc.mock.calls[2][1].p_transaction_facts_text).transactions[0]).toMatchObject({transactionId:'GRIDEX2607E66001',disposition:'accepted',responseType:'positive_aperak'})
  expect(io.capture).toHaveBeenCalledWith(company,id)
 })
 it('refuses a final matching invocation that drops the genuine periodic token, before source capture',async()=>{
  const original=source(),initial=await initialCanonicalUtiltsDecision(original),options=runtimeOptions(initial,original)
  const runtime=runUtiltsRuntimeForMessage(original,{canonicalPolicy:options.canonicalPolicy,issuerIdentityAuthority:options.issuerIdentityAuthority})
  await expect(recordFinalCanonicalUtiltsDecision({original,validated:original,initialDecision:initial,runtime})).rejects.toThrow('ediel_final_utilts_owner_unavailable')
  expect(io.capture).not.toHaveBeenCalled();expect(io.rpc).toHaveBeenCalledTimes(2)
 })
 it('cannot extract the original token from copied decisions or a changed original',async()=>{
  const original=source(),initial=await initialCanonicalUtiltsDecision(original)
  expect(readCanonicalPeriodicReasonAuthority({decision:{...initial},message:original})).toBeNull()
  expect(readCanonicalPeriodicReasonAuthority({decision:initial,message:{...original,raw_payload:original.raw_payload!.replace('STS+7++E23::260','STS+7++E88::260')}})).toBeNull()
 })
})
