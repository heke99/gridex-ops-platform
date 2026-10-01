import { test } from 'vitest'
import {originalRuleWitnessFixture} from './helpers/originalRuleWitnessFixture'
import assert from 'node:assert/strict'
import { buildReceivedSourceValidationEvidence as build } from '@/lib/ediel/core/receivedSourceValidationEvidence'
import { COMPANY, OTHER, row } from '@/__tests__/helpers/receivedSourceInventoryFixtures'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {buildReceivedUtiltsHeaderValidation} from '@/lib/ediel/core/receivedUtiltsHeaderValidation'
import {buildReceivedUtiltsTransactionValidation} from '@/lib/ediel/core/receivedUtiltsTransactionValidation'

type Input = Parameters<typeof build>[0]
function fixture(): Input {
 const source=row();const original={id:source.sourceMessageId,company_id:COMPANY,environment:'test',direction:'inbound',message_family:'PRODAT',message_standard:'edifact',
  raw_payload:source.rawPayload,message_code:source.messageCode,message_received_at:source.sourceReceivedAt,execution_context_snapshot:{receivedProdatContext:source.receivedContext}}
 return {original,validated:structuredClone(original),resolvedCompanyId:COMPANY,decision:{syntaxDecision:'rejected',applicationDecision:'not_applicable',functionalDecision:'not_applicable',
  canonical:{messageReference:'MSG1'},issues:[{code:'EDIFACT_SYNTAX_INVALID'}],validationReport:{}}}
}
test('fresh canonical rejection is source-bound facet evidence, not source approval',()=>{
 const input=fixture(),result=build(input);assert.ok(result);assert.equal(result.companyId,COMPANY)
 const facts=JSON.parse(result.factsText);assert.equal(facts.syntaxDecision,'rejected');assert.deepEqual(facts.reasonCodes,['EDIFACT_SYNTAX_INVALID'])
 assert.equal(facts.sourceDisposition,'not_established');assert.equal(facts.objectDisposition,'not_checked');assert.equal(facts.partyDisposition,'not_checked')
 assert.equal(facts.coverage,'canonical_runtime_only');assert.equal(facts.rulePackEvidence,null)
})
test('accepted canonical fields require bound real rule/version identifiers and remain not source approval',()=>{
 const input=fixture();input.decision.syntaxDecision='accepted';input.decision.applicationDecision='accepted';input.decision.functionalDecision='accepted';input.decision.issues=[]
 input.decision.validationReport.rulePackEvidence=originalRuleWitnessFixture({profileKey:'PRODAT:Z04:L:26.A:r3',messageProfileId:OTHER,rulePackId:COMPANY,sourceHash:'a'.repeat(64)})
 const result=build(input);assert.ok(result);const facts=JSON.parse(result.factsText)
 assert.equal(facts.applicationDecision,'accepted');assert.equal(facts.sourceDisposition,'not_established');assert.equal(facts.rulePackEvidence.sourceHash,'a'.repeat(64))
})
for(const [name,change] of [
 ['original tenant mismatch',(x:Input)=>{x.resolvedCompanyId=OTHER}],['current row reattributed',(x:Input)=>{x.validated.company_id=OTHER}],
 ['current environment moved',(x:Input)=>{x.validated.environment='production'}],['different actual validated bytes',(x:Input)=>{x.validated.raw_payload='changed'}],
 ['different actual message id',(x:Input)=>{x.validated.id=OTHER}],['missing context',(x:Input)=>{x.original.execution_context_snapshot={}}],
 ['bad source id',(x:Input)=>{x.original.id='forged'}],['wrong family',(x:Input)=>{x.original.message_family='UTILTS'}],
 ['wrong direction',(x:Input)=>{x.original.direction='outbound'}],['invalid receipt',(x:Input)=>{x.original.message_received_at=null}],
 ['unknown canonical state',(x:Input)=>{x.decision.syntaxDecision='approved'}],['unsafe reason',(x:Input)=>{x.decision.issues=[{code:'customer private details'}]}],
 ['too many reasons',(x:Input)=>{x.decision.issues=Array.from({length:129},(_,i)=>({code:`C${i}`}))}],
 ['unsafe canonical reference',(x:Input)=>{x.decision.canonical.messageReference='A\nB'}],
 ['acceptance without version',(x:Input)=>{x.decision.applicationDecision='accepted'}],
 ['malformed version evidence',(x:Input)=>{x.decision.validationReport.rulePackEvidence={sourceHash:'wrong'}}],
] as Array<[string,(input:Input)=>void]>) test(`cannot certify a validation facet with ${name}`,()=>{
 const input=fixture();change(input);assert.equal(build(input),null)
})
for(const [key,value] of [['contextOrigin','backfill'],['payloadHash','b'.repeat(64)],['sourceMessageId',OTHER],['companyId',OTHER],['environment','production'],['capturedAt','unknown'],['version',2]] as Array<[string,unknown]>) test(`insertion evidence mismatch ${key} cannot create an assessment`,()=>{
 const input=fixture();const parent=input.original.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>};parent.receivedProdatContext[key]=value
 assert.equal(build(input),null)
})
test('mutable report/receipt approval hints do not enter the fresh owner evidence',()=>{
 const input=fixture();const before=build(input);input.decision.validationReport.approvedSource=true;input.decision.validationReport.customerOnboarding={status:'applied'}
 assert.deepEqual(build(input),before)
})
test('evidence preparation does not mutate either source or canonical decisions',()=>{
 const input=fixture(),before=structuredClone(input);build(input);assert.deepEqual(input,before)
})


test('keeps the runtime semantic profile separate from its actual database activation key',()=>{
 const input=fixture();input.decision.applicationDecision='accepted'
 input.decision.validationReport.rulePackEvidence={...originalRuleWitnessFixture({profileKey:'PRODAT:Z04:L:26.A:r3',messageProfileId:OTHER,rulePackId:COMPANY,sourceHash:'a'.repeat(64)}),profileKey:'prodat_z04_supplier_switch_confirmation',databaseProfileKey:'PRODAT:Z04:L:26.A:r3'}
 const result=build(input);assert.ok(result)
 assert.equal(JSON.parse(result.factsText).rulePackEvidence.profileKey,'PRODAT:Z04:L:26.A:r3')
 assert.equal((input.decision.validationReport.rulePackEvidence as {profileKey:string}).profileKey,'prodat_z04_supplier_switch_confirmation')
})
for(const databaseProfileKey of ['',null,42]) test(`never substitutes the semantic profile for an explicit invalid database key ${databaseProfileKey}`,()=>{
 const input=fixture();input.decision.applicationDecision='accepted'
 input.decision.validationReport.rulePackEvidence={profileKey:'PRODAT:Z04:L:26.A:r3',databaseProfileKey,messageProfileId:OTHER,rulePackId:COMPANY,sourceHash:'a'.repeat(64)}
 assert.equal(build(input),null)
})

for(const family of ['CONTRL','APERAK','UTILTS_ERR']) test(`records the actual fresh ${family} canonical facet under its own prospective insert context`,()=>{
 const input=fixture(),snapshot=input.original.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}
 input.original.message_family=family;input.validated.message_family=family
 input.original.execution_context_snapshot={receivedAckContext:structuredClone(snapshot.receivedProdatContext)}
 input.validated.execution_context_snapshot=structuredClone(input.original.execution_context_snapshot)
 const evidence=build(input);assert.ok(evidence)
 assert.equal(JSON.parse(evidence.factsText).sourceDisposition,'not_established')
 input.original.execution_context_snapshot={receivedProdatContext:snapshot.receivedProdatContext}
 assert.equal(build(input),null,'PRODAT insertion provenance cannot stand in for ACK capture')
})
test('ordinary UTILTS shares the original canonical ledger before any storage or business approval',()=>{
 const input=fixture(),snapshot=input.original.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}
 input.original.message_family='UTILTS';input.validated.message_family='UTILTS'
 input.original.execution_context_snapshot={receivedUtiltsContext:structuredClone(snapshot.receivedProdatContext)}
 input.validated.execution_context_snapshot=structuredClone(input.original.execution_context_snapshot)
 const evidence=build(input);assert.ok(evidence)
 const facts=JSON.parse(evidence.factsText)
 assert.equal(facts.sourceDisposition,'not_established');assert.equal(facts.objectDisposition,'not_checked')
 assert.equal(facts.applicationDecision,'not_applicable');assert.equal(facts.rulePackEvidence,null)
 Object.assign(input.decision,{prodatRegisterValidation:{}})
 assert.equal(build(input),null,'UTILTS cannot acquire a PRODAT register handoff')
})
test('UTILTS cannot substitute editable or PRODAT provenance for its prospective insertion context',()=>{
 const input=fixture();input.original.message_family='UTILTS';input.validated.message_family='UTILTS'
 assert.equal(build(input),null)
})
test('an ACK facet never grants a PRODAT structural register handoff',()=>{
 const input=fixture(),snapshot=input.original.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}
 input.original.message_family='APERAK';input.validated.message_family='APERAK';input.original.execution_context_snapshot={receivedAckContext:snapshot.receivedProdatContext}
 Object.assign(input.decision,{prodatRegisterValidation:{}})
 assert.equal(build(input),null)
})
test('the additive actual header facet remains outside frozen canonical facts and requires negative complete own IDE scope',()=>{
 const message=energyHandoffMessage('2026-10-01',COMPANY);message.raw_payload=message.raw_payload!.replace('BGM+E66::260','BGM+E66::BAD')
 const runtime=runUtiltsRuntimeForMessage(message),input=fixture(),context={version:1,contextOrigin:'database_insert',sourceMessageId:OTHER,companyId:COMPANY,environment:'test',messageCode:'E66',payloadHash:evidenceHash(message.raw_payload),sourceReceivedAt:message.message_received_at,capturedAt:'2026-10-01T20:00:00Z'}
 input.original={...message,id:OTHER,execution_context_snapshot:{receivedUtiltsContext:context}};input.validated=structuredClone(input.original)
 Object.assign(input.decision,{syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'accepted',utiltsTransactionValidation:buildReceivedUtiltsTransactionValidation({source:message,transactions:runtime.transactionDispositions}),utiltsHeaderValidation:buildReceivedUtiltsHeaderValidation({source:message,headerRejection:runtime.ackPlan.utiltsHeaderRejection})})
 const evidence=build(input);assert.ok(evidence);assert.deepEqual(evidence.utiltsHeaderValidation?.applicationErrors,[{ercCode:'42',fieldCode:'202',text:'INCORRECT DATA BAD'}]);assert.equal(Object.hasOwn(JSON.parse(evidence.factsText),'utiltsHeaderValidation'),false)
 input.decision.applicationDecision='accepted';assert.equal(build(input),null)
 input.decision.applicationDecision='rejected';input.decision.syntaxDecision='rejected';assert.equal(build(input),null)
 input.decision.syntaxDecision='accepted';(input.decision.utiltsHeaderValidation as {sourcePayloadHash:string}).sourcePayloadHash='0'.repeat(64);assert.equal(build(input),null)
})
