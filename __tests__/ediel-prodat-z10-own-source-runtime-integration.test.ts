// Normal async M runtime integration. Only Supabase SDK transport is synthetic;
// protected readers/policy/validators are real and the catalogue refuses custody.
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {resolveCanonicalRuntimeDecisionWithRegistry,resolveCanonicalRuntimeDecision,
 readReceivedCanonicalProdatResponseValidation,readReceivedCanonicalProdatApplicationObjects,
 readReceivedCanonicalProdatSourceFunction} from '@/lib/ediel/core/runtimeDecision'
import {loadProdatZ10OwnSourceReadingContext,sourceProdatZ10OwnRegisterReadingDeclarations} from '@/lib/ediel/core/prodatZ10OwnSourceRegisterReadingDeclarations'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {installProdatZ10OwnSourceReadingFixture,resetProdatZ10OwnSourceReadingSdk,prodatZ10OwnSourceReadingMessage,
 id,received,type Options,type ProdatZ10OwnSourceReadingSdk} from './helpers/prodatZ10OwnSourceReadingRuntimeFixture'

const fixtureSdk=vi.hoisted(()=>({value:null as ProdatZ10OwnSourceReadingSdk|null}))
vi.mock('@/lib/supabase/service',async()=>{
 const {createProdatZ10OwnSourceReadingSdk}=await import('./helpers/prodatZ10OwnSourceReadingRuntimeFixture')
 fixtureSdk.value=createProdatZ10OwnSourceReadingSdk()
 return {supabaseService:{from:fixtureSdk.value.from,rpc:fixtureSdk.value.rpc}}
})
const io=fixtureSdk.value!
const actor=id(3),point='735123456789012344',other='735123456789012351'
const readingFields=['214','218','259']
beforeEach(()=>resetProdatZ10OwnSourceReadingSdk(io))
function fixture(options:Options={}){
 const row=prodatZ10OwnSourceReadingMessage(options)
 installProdatZ10OwnSourceReadingFixture(io,row)
 return row
}
function noPrivateAuthority(decision:Awaited<ReturnType<typeof resolveCanonicalRuntimeDecisionWithRegistry>>,source:EdielMessageRow){
 expect(decision.applicationDecision).not.toBe('accepted')
 expect(readReceivedCanonicalProdatResponseValidation(decision,source)).toBeNull()
 expect(readReceivedCanonicalProdatApplicationObjects(decision,source)).toBeNull()
 expect(readReceivedCanonicalProdatSourceFunction(decision,source)).toBeNull()
}
it('M normal registry invocation freshly reads original source and redeems first259 at selected policy',async()=>{
 const source=fixture({poison:false})
 expect(validateEdifactSyntax(source)).toMatchObject({ok:true,grammarQualification:'qualified'})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
 expect(decision.policy?.prodatDependentFacts?.registerObjects).toEqual([
  {meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:true}])
 expect(io.calls.some(call=>call.name==='ediel_require_inbound_legal_context_v1')).toBe(true)
 expect(io.calls.some(call=>call.name==='ediel_inbound_reception_request_v1')).toBe(true)
 const conditions=decision.policy?.prodatDependentConditions.filter(condition=>readingFields.includes(condition.fieldNumber))
 expect(conditions).toHaveLength(3)
 expect(conditions?.every(condition=>condition.status==='required')).toBe(true)
 expect(io.calls.some(call=>call.name==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(true)
 noPrivateAuthority(decision,source)
})
it.each([true,false])('actorless/synchronous M discards reading hints %s but preserves unrelated cell facts',async poison=>{
 const source=fixture({poison})
 source.parsed_payload={...source.parsed_payload,prodatDependentFacts:{meterReadingsSentInUtilts:poison,
  byCell:{'Z10:214':poison,'Z10:218':poison,'Z10:259':poison,'Z10:210':true,'Z10:242':false,'Z10:254':null}}}
 const facts={admissionAt:received,ownZ10SourceReadingContext:Object.freeze({}),ownZ10SourceReadingActorUserId:actor}
 const asyncDecision=await resolveCanonicalRuntimeDecisionWithRegistry(source,facts)
 const syncDecision=resolveCanonicalRuntimeDecision(source,facts)
 for(const decision of [asyncDecision,syncDecision]){
  expect(decision.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
  expect(decision.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBeUndefined()
  expect(decision.policy?.prodatDependentFacts?.byCell).toEqual({'Z10:210':true,'Z10:242':false,'Z10:254':null})
  expect(decision.policy?.prodatDependentConditions.filter(c=>readingFields.includes(c.fieldNumber)).every(c=>c.status==='undetermined')).toBe(true)
  noPrivateAuthority(decision,source)
 }
 expect(io.calls.some(c=>['gridex_actor_has_company_permission','ediel_require_inbound_legal_context_v1','ediel_inbound_reception_request_v1'].includes(c.name))).toBe(false)
})
it.each(['missing-first','duplicate-first','wrong-component-first','header'] as const)(
 '%s first259 remains own UNKNOWN even with caller TRUE and supplied later259',async declaration=>{
  const source=fixture({declaration,poison:true})
  expect(validateEdifactSyntax(source).ok).toBe(true)
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
  expect(decision.policy?.prodatDependentFacts?.registerObjects).toEqual([
   {meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:null}])
  expect(decision.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBeUndefined()
  expect(decision.policy?.prodatDependentConditions.filter(c=>readingFields.includes(c.fieldNumber)).every(c=>c.status==='undetermined')).toBe(true)
  noPrivateAuthority(decision,source)
 })
it('nonlocal first259 after RFF retains syntax refusal before lazy actor or source reads',async()=>{
 const source=fixture({declaration:'nonlocal-first',poison:true})
 expect(validateEdifactSyntax(source).ok).toBe(false)
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,
  {get actorUserId():string{throw Error('FORBIDDEN_ACTOR_BEFORE_VALID_SYNTAX')}})
 expect(decision.syntaxDecision).toBe('rejected')
 expect(decision.policy).toBeNull()
 expect(io.calls).toEqual([])
 noPrivateAuthority(decision,source)
})
it('different object with absent first259 cannot borrow the first object TRUE',async()=>{
 const source=fixture({secondObject:true,poison:true})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
 expect(decision.policy?.prodatDependentFacts?.registerObjects).toEqual([
  {meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:true},
  {meteringPointId:other,identityAgency:'9',meterReadingsSentInUtilts:null}])
 noPrivateAuthority(decision,source)
})
for(const field of ['214','218'] as const)for(const state of ['missing','invalid'] as const){
 it(`own259 TRUE retains typed ${field} ${state} at its real object scope`,async()=>{
  const source=fixture(state==='missing'?{missing:field}:{invalid:field})
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
  expect(decision.policy?.prodatDependentFacts?.registerObjects?.[0]?.meterReadingsSentInUtilts).toBe(true)
  const errors=decision.responsePlan.filter(plan=>plan.family==='APERAK'&&plan.outcome==='negative').flatMap(plan=>plan.applicationErrors??[])
  expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:field,ercCode:state==='missing'?'41':'42',
   prodatFieldDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field,errorKind:state,
    occurrence:expect.objectContaining({objectId:point,identityAgency:'9',lineItemReference:'M-OWN-1'})})})]))
  expect(decision.issues.filter(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED'&&i.prodatDiagnostic?.kind==='field'
   &&readingFields.includes(i.prodatDiagnostic.fieldNumber))).toEqual([])
  noPrivateAuthority(decision,source)
 })
}
it('later259 omission keeps first TRUE and the later required field failure',async()=>{
 const source=fixture({missing:'later259'})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
 expect(decision.policy?.prodatDependentFacts?.registerObjects?.[0]?.meterReadingsSentInUtilts).toBe(true)
 expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:
  expect.objectContaining({kind:'field',fieldNumber:'259',errorKind:'missing'})})]))
 noPrivateAuthority(decision,source)
})
it('invalid register chain cannot supply declaration scope',async()=>{
 const source=fixture({invalidChain:true,poison:true})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
 expect(decision.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
 expect(decision.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBeUndefined()
 noPrivateAuthority(decision,source)
})
const adverse:readonly [string,()=>void][]=[
 ['missing stored source',()=>{io.rows.ediel_messages=[]}],
 ['changed stored source',()=>{io.rows.ediel_messages[0].raw_payload='HOSTILE'}],
 ['foreign stored company',()=>{io.rows.ediel_messages[0].company_id=id(99)}],
 ['wrong legal receiver',()=>{io.legal.legalEdielId='99999'}],
 ['missing legal edition',()=>{delete io.legal.sourceEdition}],
 ['wrong reception hash',()=>{io.reception.canonicalPayloadHash='f'.repeat(64);io.reception.receivedPayloadHash='f'.repeat(64)}],
 ['missing reception',()=>{io.reception={}}],
 ['different mail payload',()=>{io.rows.inbound_email_messages[0].raw_edifact_payload='FOREIGN'}],
 ['different parse payload',()=>{io.rows.inbound_ediel_parse_results[0].raw_payload='FOREIGN'}],
 ['foreign parse company',()=>{io.rows.inbound_ediel_parse_results[0].company_id=id(99)}],
]
it.each(adverse)('%s keeps source declaration unavailable without hint fallback',async(_name,change)=>{
 const source=fixture({poison:true});change()
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
 expect(decision.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
 expect(decision.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBeUndefined()
 noPrivateAuthority(decision,source)
})
it.each(['ediel_messages','inbound_email_messages','inbound_ediel_parse_results'])(
 '%s SDK error remains thrown before any replacement authority',async table=>{
  const source=fixture(),error=new Error('SOURCE_TRANSPORT_STOP')
  io.tableErrors[table]=error
  await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toBe(error)
  expect(io.calls.some(c=>c.name==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(false)
 })
it.each(['ediel_require_inbound_legal_context_v1','ediel_inbound_reception_request_v1'])(
 '%s SDK error preserves its original closed disposition',async rpc=>{
  const source=fixture(),error=new Error('SOURCE_RPC_STOP')
  io.rpcErrors[rpc]=error
  if(rpc==='ediel_require_inbound_legal_context_v1')await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toThrow('ediel_inbound_legal_context_required')
  else await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toBe(error)
  expect(io.calls.some(c=>c.name==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(false)
 })
it('current actor permission loss remains security quarantine',async()=>{
 const source=fixture();io.permissions.clear()
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toMatchObject({disposition:{kind:'security_quarantine'}})
 expect(io.calls.some(c=>c.name==='ediel_require_inbound_legal_context_v1')).toBe(false)
})
it('permission revoked during awaited parse READ is rechecked and quarantined',async()=>{
 const source=fixture()
 io.afterRead=call=>{if(call.name==='inbound_ediel_parse_results')io.permissions.clear()}
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toMatchObject({disposition:{kind:'security_quarantine'}})
 expect(io.calls.some(c=>c.name==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(false)
})
it('original source changed during awaited mail READ does not produce a declaration',async()=>{
 const source=fixture({poison:true})
 io.afterRead=call=>{if(call.name==='inbound_email_messages')io.rows.ediel_messages[0].raw_payload='CHANGED_DURING_READ'}
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
 expect(decision.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
 expect(decision.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBeUndefined()
 noPrivateAuthority(decision,source)
})
it('same original microsecond admission qualifies without replacing the source clock',async()=>{
 const source=fixture()
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor,admissionAt:received})
 expect(decision.policy?.prodatDependentFacts?.registerObjects?.[0]?.meterReadingsSentInUtilts).toBe(true)
 noPrivateAuthority(decision,source)
})
it('one microsecond admission mismatch retains policy refusal',async()=>{
 const source=fixture()
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor,admissionAt:'2026-10-01T12:01:00.123457Z'})
 expect(decision.policy).toBeNull()
 expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'CANONICAL_POLICY_RESOLUTION_FAILED',description:'prodat_source_readings_admission_clock_mismatch'})]))
 noPrivateAuthority(decision,source)
})
it('an external genuine preview token cannot enter through public facts or be consumed there',async()=>{
 const source=fixture(),context=await loadProdatZ10OwnSourceReadingContext(source,actor)
 expect(context).not.toBeNull();io.calls=[]
 const facts={admissionAt:received,ownZ10SourceReadingContext:context,ownZ10SourceReadingActorUserId:actor}
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,facts)
 expect(decision.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
 expect(io.calls.some(c=>c.name==='ediel_require_inbound_legal_context_v1')).toBe(false)
 expect(sourceProdatZ10OwnRegisterReadingDeclarations({message:source,actorUserId:actor,context,policy:decision.policy!}))
  .toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:true}])
 noPrivateAuthority(decision,source)
})
it('each real invocation reads fresh authority after a previous token was consumed',async()=>{
 const source=fixture()
 const first=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
 expect(first.policy?.prodatDependentFacts?.registerObjects?.[0]?.meterReadingsSentInUtilts).toBe(true)
 io.permissions.clear()
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toMatchObject({disposition:{kind:'security_quarantine'}})
})
