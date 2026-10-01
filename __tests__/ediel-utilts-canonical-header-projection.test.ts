import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({registry:vi.fn(),runtime:vi.fn(),take:vi.fn(),unavailable:false}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.registry}))
vi.mock('@/lib/ediel/utiltsEngine',()=>({runUtiltsRuntimeForMessage:io.runtime,takeUtiltsRuntimeOwner:io.take}))
import {resolveCanonicalRuntimeDecisionWithRegistry,finalizeCanonicalUtiltsRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

// Unit boundary responses only: the runtime's actual provenance capability is
// separately exercised by ediel-final-canonical-utilts-owner tests.
function runtime(){const error={ercCode:'42',fieldCode:'202',text:io.unavailable?'':'INCORRECT DATA 9'};return {
 validation:{classification:'guide_rejected',issues:[]},transactionDispositions:[{transactionId:'GRIDEX2607E66001',disposition:'guide_rejected',responseType:'negative_aperak',issueCodes:['UTILTS_HEADER_AGENCY_INVALID']}],
 ackPlan:{shouldSendAperak:true,aperakOutcome:'negative',aperakApplicationErrors:[error],utiltsHeaderRejection:{applicationErrors:[error]},reason:'Actual own header error',shouldSendUtiltsErr:false,...(io.unavailable?{aperakSourceTextUnavailable:true}:{})},
}}
beforeEach(()=>{io.unavailable=false;io.runtime.mockReset();io.take.mockReset();io.registry.mockReset();io.runtime.mockImplementation(runtime);io.take.mockImplementation(value=>value);
 io.registry.mockResolvedValue({profileKey:'utilts_e66',databaseProfileKey:'UTILTS:E66:E5SE5A:3',messageProfileId:'p',rulePackId:'r',sourceHash:'a'.repeat(64),originalVersion:'25-A-3:r3',originalSnapshot:{rulePack:{id:'r',guide_version:'25-A-3',guide_revision:'3'},messageProfile:{id:'p',profile_key:'UTILTS:E66:E5SE5A:3'},guideSources:[]}})
})
describe('same-invocation UTILTS physical-header projection',()=>{
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
