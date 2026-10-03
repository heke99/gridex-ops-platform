import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
import {describe,it,expect,vi} from 'vitest'
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/ediel/rulebook/canonicalRulePackRegistry')>()
 const rulePackId='00000000-0000-4000-8000-000000000012',messageProfileId='00000000-0000-4000-8000-000000000011',databaseProfileKey='PRODAT:Z04:L:26.A:r3',sourceHash='a'.repeat(64)
 return {...actual,resolveCanonicalRulePack:async()=>({profileKey:'prodat_z04_supplier_switch_confirmation',databaseProfileKey,sourceHash,messageProfileId,rulePackId,
  originalVersion:'26.A:r3',originalSnapshot:{rulePack:{id:rulePackId,guide_version:'26.A',guide_revision:'3',source_hash:sourceHash},
   messageProfile:{id:messageProfileId,rule_pack_id:rulePackId,profile_key:databaseProfileKey},guideSources:[]}})}
})
import {buildReceivedProdatResponseValidation,bindReceivedProdatResponseValidation} from '@/lib/ediel/core/receivedProdatResponseValidation'
import {readReceivedCanonicalProdatResponseValidation,resolveCanonicalRuntimeDecisionWithRegistry,type CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {projectProdatRegisterValidation} from '@/lib/ediel/prodat/prodatRegisterValidationEvidence'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {prodatFieldDiagnostic} from '@/lib/ediel/prodat/prodatFieldDiagnostic'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {raw,line,input,type Parts} from './fixtures/prodat-register'
import {head,source} from './fixtures/prodat-identity'
import {ownerSource} from './helpers/sourceOwnerFixtures'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'

function fixture(body:Parts[],code='Z04'){
 const message=source(raw([...head(),...body],code),code),wire=tokenizeEdifact(message.raw_payload!)
 const decision={syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted',policy:{family:'PRODAT'},
  responsePlan:[{family:'APERAK',outcome:'positive',reason:'Explicit synthetic planned response'}],validationReport:{rulePackEvidence:{syntheticPureProjection:true}},
  prodatRegisterValidation:projectProdatRegisterValidation({code,rawSegments:wire.segments.map(segment=>segment.raw),una:wire.una,registerIssues:[],fieldIssues:[],completeRuleSelection:true,handledFields:new Set(['213'])})} as unknown as CanonicalRuntimeDecision
 return {message,decision,wire}
}
const object=(seq:string,id:string,li:string):Parts[]=>[line(seq,id,undefined,'9'),['RFF',['LI',li]]]
describe('same-plan P response projection, without source approval',()=>{
 it('projects the central renderer own positive groups separately for each physical object',()=>{
  const {message,decision}=fixture([...object('1','A','FIRST'),...object('2','B','SECOND')])
  const facet=buildReceivedProdatResponseValidation(message,decision)!
  expect(facet.objects.map(object=>object.outcome)).toEqual(['positive','positive'])
  expect(facet.responses.map(response=>[response.ercCode,response.id,response.li])).toEqual([['100','A','FIRST'],['100','B','SECOND']])
  expect(bindReceivedProdatResponseValidation(facet,message.raw_payload!)).toEqual(facet)
  expect(readReceivedCanonicalProdatResponseValidation(decision,message),'Pure shape cannot mint the runtime owner').toBeNull()
  expect(readReceivedCanonicalProdatResponseValidation(structuredClone(decision),message)).toBeNull()
 })
 it('retains one own object for a genuine register chain using the actual register grouper',()=>{
  const {message,decision}=fixture([line('1','A','1','9'),['RFF',['LI','FIRST']],line('2','A','2','9')])
  const facet=buildReceivedProdatResponseValidation(message,decision)!
  expect(facet.objects).toHaveLength(1);expect(facet.objects[0].registerLineIndices).toHaveLength(2)
  expect(facet.responses).toHaveLength(1);expect(facet.responses[0]).toMatchObject({ercCode:'100',id:'A',li:'FIRST'})
  expect(bindReceivedProdatResponseValidation(facet,message.raw_payload!)).toEqual(facet)
 })
 it('keeps an unplanned sibling held when the real plan rejects one own object',()=>{
  const {message,decision,wire}=fixture([...object('1','A','FIRST'),...object('2','B','SECOND')])
  const scoped=wire.segments.slice(wire.segments.findIndex(segment=>segment.tag==='LIN'))
  const diagnostic=prodatFieldDiagnostic('213','missing',input(message.raw_payload!,'Z04'),scoped.map(segment=>segment.raw),'P-own',0)
  const errors=projectProdatDiagnostics([{severity:'error',blocking:true,code:'OWN_MISSING',title:'Own missing',description:'Synthetic own failure',prodatDiagnostic:diagnostic}]).applicationErrors
  decision.applicationDecision='rejected';decision.responsePlan=[{family:'APERAK',outcome:'negative',reason:'Own validator plan',applicationErrors:errors}]
  // BGM34 must answer every physical object: the real renderer refuses a
  // sendable plan that leaves a sibling unanswered.
  expect(()=>renderAperakEdiel({source:{id:message.id,messageFamily:'PRODAT',messageCode:message.message_code,rawPayload:message.raw_payload,
   messageReceivedAt:message.message_received_at},refs:{},externalReference:'OWNER',transactionReference:'OWNER',outcome:'negative',applicationErrors:errors}))
   .toThrow('APERAK_PRODAT_OBJECT_OUTCOME_MISSING')
  // The prospective facet projects only the own negative; the sibling stays
  // held and no sibling success exists (its ERC 100 needs a committed effect).
  const facet=buildReceivedProdatResponseValidation(message,decision)
  expect(facet?.objects.map(object=>object.outcome)).toEqual(['negative','held'])
  expect(facet?.responses.some(response=>response.ercCode==='100')).toBe(false)
 })
 it('keeps objects held when no APERAK was actually planned',()=>{
  const {message,decision}=fixture(object('1','A','FIRST'));decision.responsePlan=[]
  expect(buildReceivedProdatResponseValidation(message,decision)).toMatchObject({responses:[],objects:[{outcome:'held'}]})
 })
 it('binds the full physical escaped reference without normalization',()=>{
  const {message,decision}=fixture(object('1','A:+?',"L:+?"))
  const facet=buildReceivedProdatResponseValidation(message,decision)!
  expect(facet.responses[0]).toMatchObject({id:'A:+?',li:'L:+?'})
  expect(bindReceivedProdatResponseValidation(facet,message.raw_payload!+' ')).toBeNull()
 })
 it('rejects a copied group, sibling field tuple or malformed serialization',()=>{
  const {message,decision}=fixture([...object('1','A','FIRST'),...object('2','B','SECOND')]),facet=buildReceivedProdatResponseValidation(message,decision)!
  for(const change of [()=>({...facet,sourcePayloadHash:'f'.repeat(64)}),()=>({...facet,objects:[facet.objects[0],facet.objects[0]]}),
   ()=>({...facet,responses:[{...facet.responses[0],li:'SECOND'}]}),()=>({...facet,responses:[{...facet.responses[0],text:'unsafe\ntext'}]})]){
   expect(bindReceivedProdatResponseValidation(change(),message.raw_payload!)).toBeNull()
  }
 })
 it('does not accept generic negative error hints in place of the actual qualified source error',()=>{
  const {message,decision}=fixture(object('1','A','FIRST'));decision.responsePlan=[{family:'APERAK',outcome:'negative',reason:'invented',applicationErrors:[{ercCode:'41',fieldCode:'213',text:'Uppskattad årsenergi saknas'}]}]
  expect(buildReceivedProdatResponseValidation(message,decision)).toBeNull()
 })
 it('does not mutate the original source or its planned decision',()=>{
  const {message,decision,wire}=fixture(object('1','A','FIRST')),before=structuredClone({message,decision})
  buildReceivedProdatResponseValidation(message,decision)
  expect({message,decision}).toEqual(before);expect(segmentComposite(wire.segments.find(segment=>segment.tag==='BGM'),1,wire.una)[0]).toBe('Z04')
 })
})

// The registry is the explicitly synthetic IO boundary here. National syntax,
// guidance, canonical responsePlan and actual own renderer run together.
describe('actual canonical invocation owns the prospective response facet',()=>{
 it('records only the original same-invocation plan and rejects cloned/mutated authority',async()=>{
  const message=ownerSource(),decision=await resolveCanonicalRuntimeDecisionWithRegistry(message)
  expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['accepted','accepted','accepted'])
  const facet=readReceivedCanonicalProdatResponseValidation(decision,message)
  expect(facet?.responses).toEqual([expect.objectContaining({scope:'object',ercCode:'100',li:'CASE-1',id:'735123456789012345'})])
  const evidence=buildReceivedSourceValidationEvidence({original:message,validated:message,resolvedCompanyId:message.company_id,decision})
  expect(evidence?.prodatResponseValidation).toEqual(facet)
  const copy=structuredClone(decision)
  expect(readReceivedCanonicalProdatResponseValidation(copy,message)).toBeNull()
  expect(buildReceivedSourceValidationEvidence({original:message,validated:message,resolvedCompanyId:message.company_id,decision:copy})?.prodatResponseValidation).toBeUndefined()
  expect(readReceivedCanonicalProdatResponseValidation(decision,{...message,company_id:'00000000-0000-4000-8000-000000000999'})).toBeNull()
  decision.responsePlan=[]
  expect(readReceivedCanonicalProdatResponseValidation(decision,message)).toBeNull()
 })
})
