import { describe, expect, it } from 'vitest'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'
import { renderProdat } from '@/lib/ediel/prodat/engine'
import type { ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'
const object={meteringPointId:'A',identityAgency:'9' as const,expectedRegisterCount:2,meterReadingsSentInUtilts:false}
const context:ProdatEngineProductionContext={code:'Z04',bgmReference:'DOC',transactionReference:'CASE',senderEdielId:'12345',receiverEdielId:'54321',meterPointId:'A',customerName:'Synthetic',customerId:'USER',gridAreaId:'TES',startDate:'202610010000',observationLength:'15',observationLengthFormat:'806',reasonForTransaction:'Z22',registers:[{annualConsumption:'10'},{annualConsumption:'20'}],dependentConditionFacts:{market:'electricity',registerObjects:[object]}}
function build(snapshot:Record<string,unknown>|null,engine:boolean){
 return engine ? renderProdat({code:'Z04',mode:'test',variant:'L',context,portalSnapshot:snapshot,actor:{senderEdielId:'12345',receiverEdielId:'54321'},route:{applicationReference:'23-DDQ-PRODAT'},version:{selectedVersion:'E2SE6A',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A'},generatedAt:new Date('2026-09-18T00:00:00Z')}) : buildProfiledProdatSegments({context,portalSnapshot:snapshot,mode:'test',variant:'L',generatedAt:new Date('2026-09-18T00:00:00Z')})
}
describe.each([false,true])('authoritative snapshot facts, engine=%s',engine=>{
 it('keeps context facts only when a snapshot does not override them',()=>{
  expect(build({registers:[{annualConsumption:'11'},{annualConsumption:'21'}]},engine).diagnostics.registerEvidence?.facts.registerObjects).toEqual([object])
 })
 it('uses the snapshot object facts instead of stale context facts',()=>{
  const own={...object,meterReadingsSentInUtilts:true}
  expect(build({dependentConditionFacts:{market:'electricity',registerObjects:[own]}},engine).diagnostics.registerEvidence?.facts.registerObjects).toEqual([own])
 })
 for(const value of [null,{}]) it(`does not fall back after an explicit facts clear ${JSON.stringify(value)}`,()=>{
  expect(build({dependentConditionFacts:value},engine).diagnostics.registerEvidence?.facts.registerObjects).toBeUndefined()
 })
 it('keeps a detached copy, not a mutable snapshot reference',()=>{
  const facts={market:'electricity',registerObjects:[{...object}]};const result=build({dependentConditionFacts:facts},engine);facts.registerObjects[0].meterReadingsSentInUtilts=true
  expect(result.diagnostics.registerEvidence?.facts.registerObjects?.[0].meterReadingsSentInUtilts).toBe(false)
 })
 for(const value of [false,'approved',{registerObjects:[{...object,meterReadingsSentInUtilts:'false'}]}]) it('rejects malformed snapshot evidence rather than falling back',()=>expect(()=>build({dependentConditionFacts:value},engine)).toThrow(/prodat_register/))
})
