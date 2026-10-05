import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({rpc:vi.fn(),registry:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.registry}))
import * as engine from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalRuntimeDecisionWithRegistry,readCanonicalUtiltsIssuerIdentityAuthority,finalizeCanonicalUtiltsRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {utiltsIssuerIdentityFacts} from '@/lib/ediel/utilts/issuerIdentityAuthority'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'

const company='10000000-0000-4000-8000-000000000001'
function source(){return {...energyHandoffMessage('2026-09-30',company),id:'20000000-0000-4000-8000-000000000001'}}
function nativeReply(message:ReturnType<typeof source>,changes:Record<string,unknown>={}){
 return {data:{version:1,companyId:message.company_id,environment:message.environment,sourceMessageId:message.id,
  sourcePayloadHash:createHash('sha256').update(message.raw_payload!).digest('hex'),status:'qualified',
  authorityVersionId:'30000000-0000-4000-8000-000000000001',namespaceEpoch:'2',messageReferenceCollision:false,
  transactionReferenceCollisions:[],holdReason:null,...changes},error:null}
}
beforeEach(()=>{
 vi.restoreAllMocks();vi.clearAllMocks()
 // Synthetic immutable registry/native ports only. These do not demonstrate
 // authentic issuer ownership, complete historical absence or native replay.
 io.registry.mockResolvedValue({profileKey:'utilts_e66',messageProfileId:'40000000-0000-4000-8000-000000000001',rulePackId:'50000000-0000-4000-8000-000000000001',sourceHash:'a'.repeat(64),originalVersion:'25-A-3:r3',originalSnapshot:{rulePack:{guide_version:'25-A-3',guide_revision:'3'},messageProfile:{profile_key:'UTILTS:E66:E5SE5A:3'},guideSources:[]}})
})
describe('same-owner UTILTS issuer authority integration',()=>{
 it('reads once before one operational invocation and reuses the same token and original guide on final matching',async()=>{
  const message=source();io.rpc.mockResolvedValue(nativeReply(message))
  const run=vi.spyOn(engine,'runUtiltsRuntimeForMessage')
  const initial=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  const authority=readCanonicalUtiltsIssuerIdentityAuthority({decision:initial,message})
  expect(authority).not.toBeNull()
  expect(utiltsIssuerIdentityFacts({authority:authority!,message,policy:initial.policy!}).status).toBe('qualified')
  const operational=run.mock.calls.filter(([,options])=>!options?.guideOnly)
  expect(operational).toHaveLength(1)
  expect(operational[0][1]?.canonicalPolicy).toBe(initial.policy)
  expect(operational[0][1]?.issuerIdentityAuthority).toBe(authority)
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('gridex_read_utilts_issuer_identity_authority_v1',{p_company_id:company,p_message_id:message.id})
  const runtime=engine.runUtiltsRuntimeForMessage(message,{canonicalPolicy:initial.policy!,issuerIdentityAuthority:authority!})
  const final=finalizeCanonicalUtiltsRuntimeDecision({message,initialDecision:initial,runtime})
  expect(final.policy).toBe(initial.policy)
  expect(final.validationReport.rulePackEvidence).toBe(initial.validationReport.rulePackEvidence)
  expect(io.registry).toHaveBeenCalledTimes(1);expect(io.rpc).toHaveBeenCalledTimes(1)
  expect(readCanonicalUtiltsIssuerIdentityAuthority({decision:initial,message})).toBeNull()
 })
 it('does not qualify a copied initial decision, altered original, or a final runtime without the initial token',async()=>{
  const message=source();io.rpc.mockResolvedValue(nativeReply(message))
  const initial=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(readCanonicalUtiltsIssuerIdentityAuthority({decision:{...initial},message})).toBeNull()
  expect(readCanonicalUtiltsIssuerIdentityAuthority({decision:initial,message:{...message,raw_payload:message.raw_payload+' '}})).toBeNull()
  const runtime=engine.runUtiltsRuntimeForMessage(message,{canonicalPolicy:initial.policy!})
  expect(()=>finalizeCanonicalUtiltsRuntimeDecision({message,initialDecision:initial,runtime})).toThrow('ediel_final_utilts_owner_unavailable')
 })
 it('retains syntax first without a foreign issuer read or operational invocation',async()=>{
  const message=source();message.raw_payload+="FTX+AAI+++dangling?"
  const run=vi.spyOn(engine,'runUtiltsRuntimeForMessage')
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(decision.syntaxDecision).toBe('rejected');expect(io.rpc).not.toHaveBeenCalled();expect(run).not.toHaveBeenCalled()
 })
 it('holds unavailable issuer/history authority locally without inventing a national duplicate',async()=>{
  const message=source();io.rpc.mockResolvedValue({data:null,error:null})
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(decision.applicationDecision).toBe('manual_review')
  expect(decision.functionalDecision).toBe('manual_review')
  expect(decision.utiltsTransactionValidation?.transactions.every(own=>own.disposition!=='accepted')).toBe(true)
  expect(decision.responsePlan.some(response=>response.family==='APERAK'||response.family==='UTILTS_ERR')).toBe(false)
  expect(decision.utiltsHeaderValidation).toBeUndefined()
 })
 it('refuses a foreign native source hash as a local incident without fabricating AP42',async()=>{
  const message=source();io.rpc.mockResolvedValue(nativeReply(message,{sourcePayloadHash:'f'.repeat(64)}))
  const run=vi.spyOn(engine,'runUtiltsRuntimeForMessage')
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(decision.applicationDecision).toBe('manual_review')
  expect(decision.responsePlan.some(response=>response.family==='APERAK'||response.family==='UTILTS_ERR')).toBe(false)
  expect(run.mock.calls.filter(([,options])=>!options?.guideOnly)).toHaveLength(0)
  expect(io.registry).not.toHaveBeenCalled()
 })
 it.each(['returned','thrown'])('preserves independent national own505 rejection under %s issuer infrastructure failure',async kind=>{
  const message=source();message.raw_payload=recountEdifactUnt(message.raw_payload!.replace('IDE+24+GRIDEX2607E66001','IDE+24+'))
  if(kind==='returned')io.rpc.mockResolvedValue({data:null,error:{message:'network unavailable'}})
  else io.rpc.mockRejectedValue(new Error('network unavailable'))
  const run=vi.spyOn(engine,'runUtiltsRuntimeForMessage')
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(run.mock.calls.filter(([,options])=>!options?.guideOnly)).toHaveLength(1)
  expect(decision.responsePlan).toContainEqual(expect.objectContaining({family:'APERAK',outcome:'negative',applicationErrors:expect.arrayContaining([expect.objectContaining({ercCode:'41',fieldCode:'505'})])}))
  expect(decision.utiltsTransactionValidation?.transactions.every(own=>own.disposition!=='accepted')).toBe(true)
  expect(decision.issues.some(issue=>issue.code==='UTILTS_ISSUER_MESSAGE_REFERENCE_DUPLICATE'||issue.code==='UTILTS_ISSUER_TRANSACTION_REFERENCE_DUPLICATE')).toBe(false)
 })
 it('keeps an authenticated known field203 collision while historical absence remains separately held',async()=>{
  const message=source();io.rpc.mockResolvedValue(nativeReply(message,{status:'held',messageReferenceCollision:true,holdReason:'ediel_utilts_identity_history_coverage_unavailable'}))
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(decision.utiltsHeaderValidation?.applicationErrors).toContainEqual(expect.objectContaining({ercCode:'42',fieldCode:'203'}))
  expect(decision.utiltsTransactionValidation?.transactions.every(own=>own.disposition!=='accepted')).toBe(true)
  expect(decision.responsePlan).toContainEqual(expect.objectContaining({family:'APERAK',outcome:'negative',utiltsHeaderRejected:true}))
 })
})
