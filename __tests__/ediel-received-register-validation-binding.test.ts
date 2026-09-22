import {test, expect} from 'vitest'
import {buildReceivedSourceValidationEvidence as build} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import {COMPANY, OTHER, row} from './helpers/receivedSourceInventoryFixtures'

function fixture() {
  const source = row()
  const original = {id:source.sourceMessageId,company_id:COMPANY,environment:'test',direction:'inbound',message_family:'PRODAT',message_standard:'edifact',
    raw_payload:source.rawPayload,message_code:source.messageCode,message_received_at:source.sourceReceivedAt,execution_context_snapshot:{receivedProdatContext:source.receivedContext}}
  return {original,validated:structuredClone(original),resolvedCompanyId:COMPANY,decision:{syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',
    canonical:{messageReference:'MSG1'},issues:[],validationReport:{rulePackEvidence:{profileKey:'PRODAT:Z04:L:26.A:r3',messageProfileId:OTHER,rulePackId:COMPANY,sourceHash:'a'.repeat(64)}},
    prodatRegisterValidation:{version:1,owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:[
      {messageIndex:0,messageReference:'MSG1',objectId:'MP-A',identityAgency:'9',disposition:'accepted',reasons:[],registers:[{lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1,segmentIndex:3}]},
      {messageIndex:0,messageReference:'MSG1',objectId:'MP-B',identityAgency:'89',disposition:'rejected',reasons:['PRODAT_REGISTER_INVALID'],registers:[{lineIndex:1,lineNumber:'2',registerIndex:null,registerPosition:1,segmentIndex:4}]},
    ]}}}
}
type Input = ReturnType<typeof fixture>

test('actual object register decisions enter source-bound immutable facts without approving the source',()=>{
  const input=fixture(), result=build(input)
  expect(result).not.toBeNull()
  const facts=JSON.parse(result!.factsText)
  expect(facts.registerValidation).toEqual(input.decision.prodatRegisterValidation)
  expect([facts.sourceDisposition,facts.objectDisposition,facts.partyDisposition]).toEqual(['not_established','not_checked','not_checked'])
  expect(facts.registerValidation.objects.map((o:{disposition:string})=>o.disposition)).toEqual(['accepted','rejected'])
})
for (const [name,change] of [
  ['wrong owner',(x:Input)=>{x.decision.prodatRegisterValidation.owner='status_json'}],
  ['wrong coverage',(x:Input)=>{x.decision.prodatRegisterValidation.coverage='full_source'}],
  ['wrong version',(x:Input)=>{x.decision.prodatRegisterValidation.version=2}],
  ['foreign object',(x:Input)=>{x.decision.prodatRegisterValidation.objects[0].objectId='OTHER'}],
  ['wrong agency',(x:Input)=>{x.decision.prodatRegisterValidation.objects[0].identityAgency='89'}],
  ['wrong message',(x:Input)=>{x.decision.prodatRegisterValidation.objects[0].messageIndex=1}],
  ['wrong reference',(x:Input)=>{x.decision.prodatRegisterValidation.objects[0].messageReference='OTHER'}],
  ['wrong occurrence',(x:Input)=>{x.decision.prodatRegisterValidation.objects[0].registers[0].segmentIndex=4}],
  ['missing object',(x:Input)=>{x.decision.prodatRegisterValidation.objects.pop()}],
  ['duplicate object',(x:Input)=>{x.decision.prodatRegisterValidation.objects.push(x.decision.prodatRegisterValidation.objects[0])}],
  ['missing register',(x:Input)=>{x.decision.prodatRegisterValidation.objects[0].registers=[]}],
  ['contradictory accepted outcome',(x:Input)=>{x.decision.prodatRegisterValidation.objects[1].disposition='accepted'}],
  ['unexplained rejection',(x:Input)=>{x.decision.prodatRegisterValidation.objects[1].reasons=[]}],
  ['unsafe reason',(x:Input)=>{x.decision.prodatRegisterValidation.objects[1].reasons=['private details']}],
  ['approval injection',(x:Input)=>{Object.assign(x.decision.prodatRegisterValidation,{sourceApproved:true})}],
] as [string,(x:Input)=>void][]) test(`malformed or unbound register evidence: ${name}`,()=>{
  const input=fixture();change(input);expect(build(input)).toBeNull()
})
test('register facets require actual rule-pack provenance even if overall application rejected',()=>{
  const input=fixture();input.decision.applicationDecision='rejected';Object.assign(input.decision.validationReport,{rulePackEvidence:null})
  expect(build(input)).toBeNull()
})
test('operational report register JSON is never used as actual validator output',()=>{
  const input=fixture();const {prodatRegisterValidation,...decision}=input.decision
  Object.assign(decision.validationReport,{prodatRegisterValidation})
  const result=build({...input,decision})
  expect(result).not.toBeNull();expect(JSON.parse(result!.factsText)).not.toHaveProperty('registerValidation')
})
