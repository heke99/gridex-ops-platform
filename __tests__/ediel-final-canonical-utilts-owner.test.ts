import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({registry:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.registry}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
import {resolveCanonicalRuntimeDecision,resolveCanonicalRuntimeDecisionWithRegistry,finalizeCanonicalUtiltsRuntimeDecision,readCanonicalUtiltsIssuerIdentityAuthority} from '@/lib/ediel/core/runtimeDecision'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
beforeEach(()=>{io.registry.mockReset();io.registry.mockImplementation(async()=>({profileKey:'utilts_e66',databaseProfileKey:'UTILTS:E66:E5SE5A:3',messageProfileId:'p',rulePackId:'r',sourceHash:'a'.repeat(64),originalVersion:'25-A-3:r3',originalSnapshot:{rulePack:{id:'r',guide_version:'25-A-3',guide_revision:'3'},messageProfile:{id:'p',profile_key:'UTILTS:E66:E5SE5A:3'},guideSources:[]}}))})
/** Modeled external issuer evidence retains the original owner invariants;
 * this is neither an authenticated issuer/history nor a native replay proof. */
async function initialFor(message:ReturnType<typeof energyHandoffMessage>){
 io.rpc.mockResolvedValue({data:{version:1,companyId:message.company_id,environment:message.environment,sourceMessageId:message.id,
  sourcePayloadHash:createHash('sha256').update(message.raw_payload!).digest('hex'),status:'qualified',authorityVersionId:'10000000-0000-4000-8000-000000000001',namespaceEpoch:'1',messageReferenceCollision:false,transactionReferenceCollisions:[],holdReason:null},error:null})
 return resolveCanonicalRuntimeDecisionWithRegistry(message)
}
describe('final shared UTILTS actual owner retains first guide and witness',()=>{
 it('consumes one real final runtime and retains exact original guide and registry witness without another read',async()=>{
  const message=energyHandoffMessage(),initialDecision=await initialFor(message)
  expect(initialDecision.applicationDecision).toBe('accepted')
  const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy:initialDecision.policy!,issuerIdentityAuthority:readCanonicalUtiltsIssuerIdentityAuthority({decision:initialDecision,message})!})
  const final=finalizeCanonicalUtiltsRuntimeDecision({message,initialDecision,runtime})
  expect(final.policy).toBe(initialDecision.policy)
  expect(final.validationReport.rulePackEvidence).toBe(initialDecision.validationReport.rulePackEvidence)
  expect(final.utiltsTransactionValidation?.transactions[0]).toMatchObject({transactionId:'GRIDEX2607E66001',disposition:'accepted'})
  expect(io.registry).toHaveBeenCalledTimes(1)
  expect(()=>finalizeCanonicalUtiltsRuntimeDecision({message,initialDecision,runtime})).toThrow('ediel_initial_utilts_owner_unavailable')
 })
 it('rejects an unregistered initial decision, a copied initial owner and altered original source',async()=>{
  const message=energyHandoffMessage(),initialDecision=await initialFor(message)
  const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy:initialDecision.policy!,issuerIdentityAuthority:readCanonicalUtiltsIssuerIdentityAuthority({decision:initialDecision,message})!})
  for(const original of [resolveCanonicalRuntimeDecision(message),{...initialDecision}])expect(()=>finalizeCanonicalUtiltsRuntimeDecision({message,initialDecision:original,runtime})).toThrow('ediel_initial_utilts_owner_unavailable')
  expect(()=>finalizeCanonicalUtiltsRuntimeDecision({message:{...message,company_id:'foreign'},initialDecision,runtime})).toThrow('ediel_initial_utilts_owner_unavailable')
  expect(()=>finalizeCanonicalUtiltsRuntimeDecision({message:{...message,raw_payload:message.raw_payload+' '},initialDecision,runtime})).toThrow('ediel_initial_utilts_owner_unavailable')
 })
 it('retains genuine all-negative own scope under a failed registry with no positive authority',async()=>{
  const message=energyHandoffMessage();message.raw_payload=recountEdifactUnt(message.raw_payload!.replace("QTY+136:500'","QTY+136:500'\nQTY+136:501'"))
  io.registry.mockRejectedValue(new Error('registry-local-unavailable'))
  const initialDecision=await initialFor(message)
  expect(initialDecision.utiltsTransactionValidation?.transactions.every(item=>item.disposition!=='accepted')).toBe(true)
  const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy:initialDecision.policy!,issuerIdentityAuthority:readCanonicalUtiltsIssuerIdentityAuthority({decision:initialDecision,message})!})
  const final=finalizeCanonicalUtiltsRuntimeDecision({message,initialDecision,runtime})
  expect(final.applicationDecision).toBe('manual_review');expect(final.functionalDecision).toBe('manual_review')
  expect(final.validationReport.rulePackEvidence).toBeUndefined()
  expect(final.validationReport.failureDisposition).toEqual(initialDecision.validationReport.failureDisposition)
  expect(final.responsePlan.every(item=>item.family==='CONTRL')).toBe(true)
  expect(final.utiltsTransactionValidation?.transactions.every(item=>item.disposition!=='accepted')).toBe(true)
 })
 it('cannot mint an initial no-witness owner when any physical sibling was accepted',async()=>{
  const message=energyHandoffMessage();io.registry.mockRejectedValue(new Error('registry-local-unavailable'))
  const initialDecision=await initialFor(message)
  const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy:initialDecision.policy!,issuerIdentityAuthority:readCanonicalUtiltsIssuerIdentityAuthority({decision:initialDecision,message})!})
  expect(()=>finalizeCanonicalUtiltsRuntimeDecision({message,initialDecision,runtime})).toThrow('ediel_initial_utilts_owner_unavailable')
 })
 it('cannot promote a copied or mutated final runtime into a new own-IDE acceptance',async()=>{
  for(const mutate of [(r:ReturnType<typeof runUtiltsRuntimeForMessage>)=>({...r}),(r:ReturnType<typeof runUtiltsRuntimeForMessage>)=>{r.transactionDispositions[0].issueCodes.push('FORGED');return r}]){
   const message=energyHandoffMessage(),initialDecision=await initialFor(message)
   const runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy:initialDecision.policy!,issuerIdentityAuthority:readCanonicalUtiltsIssuerIdentityAuthority({decision:initialDecision,message})!})
   expect(()=>finalizeCanonicalUtiltsRuntimeDecision({message,initialDecision,runtime:mutate(runtime)})).toThrow('ediel_final_utilts_owner_unavailable')
  }
 })
})
