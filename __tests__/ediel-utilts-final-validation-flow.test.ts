import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({registry:vi.fn(),rpc:vi.fn(),capture:vi.fn(),unconfirmed:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async()=>({...await vi.importActual<object>('@/lib/ediel/rulebook/canonicalRulePackRegistry'),resolveCanonicalRulePack:io.registry}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/core/sourceRulePackEvidence',()=>({captureFreshEdielSourceRulePackEvidence:io.capture}))
import {initialCanonicalUtiltsDecision,recordFinalCanonicalUtiltsDecision} from '@/lib/ediel/flows/utiltsCanonicalValidation'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {qualifyReceivedUtiltsStructure} from '@/lib/ediel/utilts/qualifyReceivedStructure'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
const company='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',packId='33333333-3333-4333-8333-333333333333',profileId='44444444-4444-4444-8444-444444444444'
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
function source(){const message={...energyHandoffMessage('2026-10-01',company),id};return {...message,execution_context_snapshot:{receivedUtiltsContext:{version:1,contextOrigin:'database_insert',sourceMessageId:id,companyId:company,environment:'test',messageCode:'E66',payloadHash:hash(message.raw_payload!),sourceReceivedAt:message.message_received_at,capturedAt:'2026-10-01T20:00:00Z'}}}}
beforeEach(()=>{io.unconfirmed=false;io.registry.mockReset();io.rpc.mockReset();io.capture.mockReset();io.capture.mockResolvedValue({status:'captured',evidence:{}})
 io.registry.mockResolvedValue({profileKey:'utilts_e66',databaseProfileKey:'UTILTS:E66:E5SE5A:4',messageProfileId:profileId,rulePackId:packId,sourceHash:'a'.repeat(64),originalVersion:'25-A-4:r4',originalSnapshot:{rulePack:{id:packId,source_hash:'a'.repeat(64),guide_version:'25-A-4',guide_revision:'4'},messageProfile:{id:profileId,rule_pack_id:packId,profile_key:'UTILTS:E66:E5SE5A:4'},guideSources:[{id:'55555555-5555-4555-8555-555555555555',rule_pack_id:packId}]}})
 io.rpc.mockImplementation((name:string,args:Record<string,string>)=>({abortSignal:async()=>({error:io.unconfirmed ? {message:'fixture unavailable'} : null,data:{version:1,assessmentId:'66666666-6666-4666-8666-666666666666',companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,sourceDisposition:'not_established',factsHash:hash(args.p_facts_text),transactionFactsHash:args.p_transaction_facts_text ? hash(args.p_transaction_facts_text) : null}})}))
})
describe('final UTILTS actual matching owner to native evidence handoff',()=>{
 it('retains the one initial registry pass and appends the actual structural-qualified own facet before capture',async()=>{
  const original=source(),initial=await initialCanonicalUtiltsDecision(original),validated={...original,customer_id:'77777777-7777-4777-8777-777777777777'}
  const qualified=await qualifyReceivedUtiltsStructure({message:validated,canonicalPolicy:initial.policy,runtime:runUtiltsRuntimeForMessage(validated,{canonicalPolicy:initial.policy})})
  const result=await recordFinalCanonicalUtiltsDecision({original,validated,initialDecision:initial,runtime:qualified.runtime})
  expect(result.receipt.status).toBe('recorded');expect(result.decision.policy).toBe(initial.policy);expect(io.registry).toHaveBeenCalledTimes(1)
  expect(io.rpc).toHaveBeenCalledTimes(1);expect(io.rpc.mock.calls[0][0]).toBe('gridex_record_utilts_source_validation_v1')
  const args=io.rpc.mock.calls[0][1];expect(JSON.parse(args.p_transaction_facts_text).transactions[0]).toMatchObject({transactionId:'GRIDEX2607E66001',disposition:'accepted',responseType:'positive_aperak'})
  expect(JSON.parse(args.p_facts_text).rulePackEvidence.version).toBe('25-A-4:r4');expect(io.capture).toHaveBeenCalledWith(company,id)
  expect(io.capture.mock.invocationCallOrder[0]).toBeGreaterThan(io.rpc.mock.invocationCallOrder[0])
 })
 it('holds an unconfirmed own facet before any positive source capture or native effect',async()=>{
  const original=source(),initial=await initialCanonicalUtiltsDecision(original),runtime=runUtiltsRuntimeForMessage(original,{canonicalPolicy:initial.policy});io.unconfirmed=true
  await expect(recordFinalCanonicalUtiltsDecision({original,validated:original,initialDecision:initial,runtime})).rejects.toThrow('utilts_final_canonical_transaction_evidence_unconfirmed')
  expect(io.capture).not.toHaveBeenCalled()
 })
 it('freezes a genuine negative-only final facet under registry hold without capturing or inventing a pack',async()=>{
  const original=source();original.raw_payload=original.raw_payload!.replace('QTY+136:500','QTY+136:500.0000');original.execution_context_snapshot!.receivedUtiltsContext={...(original.execution_context_snapshot!.receivedUtiltsContext as object),payloadHash:hash(original.raw_payload)}
  io.registry.mockRejectedValue(new Error('CANONICAL_RULE_PACK_EVIDENCE_NOT_ACTIVE'))
  const initial=await initialCanonicalUtiltsDecision(original),runtime=runUtiltsRuntimeForMessage(original,{canonicalPolicy:initial.policy})
  const result=await recordFinalCanonicalUtiltsDecision({original,validated:original,initialDecision:initial,runtime})
  expect(result.decision.applicationDecision).toBe('manual_review');expect(result.decision.utiltsTransactionValidation?.transactions[0].disposition).toBe('processability_rejected')
  expect(JSON.parse(io.rpc.mock.calls[0][1].p_facts_text).rulePackEvidence).toBeNull();expect(io.capture).not.toHaveBeenCalled()
 })
})
