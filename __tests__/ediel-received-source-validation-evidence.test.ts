import { test } from 'vitest'
import assert from 'node:assert/strict'
import { buildReceivedSourceValidationEvidence as build } from '@/lib/ediel/core/receivedSourceValidationEvidence'
import { COMPANY, OTHER, row } from '@/__tests__/helpers/receivedSourceInventoryFixtures'

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
 input.decision.validationReport.rulePackEvidence={profileKey:'PRODAT:Z04:L:26.A:r3',messageProfileId:OTHER,rulePackId:COMPANY,sourceHash:'a'.repeat(64)}
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
 input.decision.validationReport.rulePackEvidence={profileKey:'prodat_z04_supplier_switch_confirmation',databaseProfileKey:'PRODAT:Z04:L:26.A:r3',messageProfileId:OTHER,rulePackId:COMPANY,sourceHash:'a'.repeat(64)}
 const result=build(input);assert.ok(result)
 assert.equal(JSON.parse(result.factsText).rulePackEvidence.profileKey,'PRODAT:Z04:L:26.A:r3')
 assert.equal((input.decision.validationReport.rulePackEvidence as {profileKey:string}).profileKey,'prodat_z04_supplier_switch_confirmation')
})
for(const databaseProfileKey of ['',null,42]) test(`never substitutes the semantic profile for an explicit invalid database key ${databaseProfileKey}`,()=>{
 const input=fixture();input.decision.applicationDecision='accepted'
 input.decision.validationReport.rulePackEvidence={profileKey:'PRODAT:Z04:L:26.A:r3',databaseProfileKey,messageProfileId:OTHER,rulePackId:COMPANY,sourceHash:'a'.repeat(64)}
 assert.equal(build(input),null)
})
