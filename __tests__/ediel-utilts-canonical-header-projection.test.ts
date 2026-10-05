import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({registry:vi.fn(),runtime:vi.fn(),take:vi.fn(),rpc:vi.fn(),unavailable:false,functional:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.registry}))
vi.mock('@/lib/ediel/utiltsEngine',()=>({runUtiltsRuntimeForMessage:io.runtime,takeUtiltsRuntimeOwner:io.take}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
import {resolveCanonicalRuntimeDecisionWithRegistry,finalizeCanonicalUtiltsRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

// Unit boundary responses only: the runtime's actual provenance capability is
// separately exercised by ediel-final-canonical-utilts-owner tests.
function runtime(){if(io.functional)return {validation:{classification:'processable',issues:[]},transactionDispositions:[{transactionId:'GRIDEX2607E66001',disposition:'processability_rejected',responseType:'utilts_err',issueCodes:['LOCAL_OWN']}],ackPlan:{shouldSendUtiltsErr:true,reason:'Actual national functional response',utiltsErrDetails:[{code:'E14',referenceQualifier:'TN',referenceNumber:'GRIDEX2607E66001',lineItemReference:'GRIDEX2607E66001'}]}};const error={ercCode:'42',fieldCode:'202',text:io.unavailable?'':'INCORRECT DATA 9'};return {
 validation:{classification:'guide_rejected',issues:[]},transactionDispositions:[{transactionId:'GRIDEX2607E66001',disposition:'guide_rejected',responseType:'negative_aperak',issueCodes:['UTILTS_HEADER_AGENCY_INVALID']}],
 ackPlan:{shouldSendAperak:true,aperakOutcome:'negative',aperakApplicationErrors:[error],utiltsHeaderRejection:{applicationErrors:[error]},reason:'Actual own header error',shouldSendUtiltsErr:false,...(io.unavailable?{aperakSourceTextUnavailable:true}:{})},
}}
beforeEach(()=>{io.unavailable=false;io.functional=false;io.runtime.mockReset();io.take.mockReset();io.registry.mockReset();io.runtime.mockImplementation(runtime);io.take.mockImplementation(value=>value);
 // This projection-only test declares the missing source-read port as held,
 // not qualified market authority. The actual issuer owner still validates it.
 io.rpc.mockReset();io.rpc.mockResolvedValue({data:null,error:null})
 io.registry.mockResolvedValue({profileKey:'utilts_e66',databaseProfileKey:'UTILTS:E66:E5SE5A:3',messageProfileId:'p',rulePackId:'r',sourceHash:'a'.repeat(64),originalVersion:'25-A-3:r3',originalSnapshot:{rulePack:{id:'r',guide_version:'25-A-3',guide_revision:'3'},messageProfile:{id:'p',profile_key:'UTILTS:E66:E5SE5A:3'},guideSources:[]}})
})
afterEach(()=>{
 const message=energyHandoffMessage()
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('gridex_read_utilts_issuer_identity_authority_v1',{
  p_company_id:message.company_id,p_message_id:message.id,
 })
})
describe('same-invocation UTILTS physical-header projection',()=>{
 it('retains only actual own national functional response details through initial and final without another rule pass',async()=>{
  io.functional=true
  const message=energyHandoffMessage(),initial=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  const expected=[{transactionIndex:0,transactionId:'GRIDEX2607E66001',errors:[{code:'E14',referenceQualifier:'TN',referenceNumber:'GRIDEX2607E66001'}]}]
  expect(initial.utiltsFunctionalValidation?.transactions).toEqual(expected)
  const final=finalizeCanonicalUtiltsRuntimeDecision({message,initialDecision:initial,runtime:runtime() as never})
  expect(final.utiltsFunctionalValidation?.transactions).toEqual(expected)
  expect(final.responsePlan.some(response=>response.family==='UTILTS_ERR')).toBe(true)
  expect(io.registry).toHaveBeenCalledTimes(1)
 })
 it('retains exact source-owned triplets through both initial and final canonical result',async()=>{
  const message=energyHandoffMessage(),initial=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(initial.utiltsHeaderValidation?.applicationErrors).toEqual([{ercCode:'42',fieldCode:'202',text:'INCORRECT DATA 9'}])
  const final=finalizeCanonicalUtiltsRuntimeDecision({message,initialDecision:initial,runtime:runtime() as never})
  expect(final.utiltsHeaderValidation).toEqual(initial.utiltsHeaderValidation)
  expect(final.utiltsTransactionValidation?.transactions[0].disposition).toBe('guide_rejected')
  expect(final.validationReport.rulePackEvidence).toBe(initial.validationReport.rulePackEvidence)
  expect(io.registry).toHaveBeenCalledTimes(1)
 })
 it('keeps rejection and own-IDE diagnostics when original wrong data cannot be rendered, and emits no AP',async()=>{
  io.unavailable=true
  const message=energyHandoffMessage(),initial=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect(initial.applicationDecision).toBe('rejected');expect(initial.functionalDecision).toBe('not_applicable')
  expect(initial.utiltsTransactionValidation?.transactions[0].disposition).toBe('guide_rejected')
  expect(initial.utiltsHeaderValidation).toBeUndefined()
  expect(initial.responsePlan.some(response=>response.family==='APERAK')).toBe(false)
  const final=finalizeCanonicalUtiltsRuntimeDecision({message,initialDecision:initial,runtime:runtime() as never})
  expect(final.applicationDecision).toBe('rejected');expect(final.functionalDecision).toBe('not_applicable')
  expect(final.responsePlan.some(response=>response.family==='APERAK')).toBe(false)
 })
})
