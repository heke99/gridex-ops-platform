// Finite automatic L/LK source-declaration integration only. Real source,
// actor/legal/reception readers, runtime/policy/field/register and registry gates
// execute. Declared SDK catalogue refuses: no durable APP, ACK or whole proof.
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {resolveCanonicalRuntimeDecisionWithRegistry,resolveCanonicalRuntimeDecision,
 readReceivedCanonicalProdatResponseValidation,readReceivedCanonicalProdatApplicationObjects,
 readReceivedCanonicalProdatSourceFunction} from '@/lib/ediel/core/runtimeDecision'
import {loadProdatOwnSourceReadingContext,sourceProdatOwnRegisterReadingDeclarations} from '@/lib/ediel/core/prodatOwnSourceRegisterReadingDeclarations'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic,line,qty,type Parts} from './fixtures/prodat-register'
import {installProdatOwnSourceReadingFixture,resetProdatOwnSourceReadingSdk,prodatOwnSourceReadingMessage,
 type ProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'

const fixtureSdk=vi.hoisted(()=>({value:null as ProdatOwnSourceReadingSdk|null}))
vi.mock('@/lib/supabase/service',async()=>{
 const {createProdatOwnSourceReadingSdk}=await import('./helpers/prodatOwnSourceReadingFixture')
 fixtureSdk.value=createProdatOwnSourceReadingSdk()
 return {supabaseService:{from:fixtureSdk.value.from,rpc:fixtureSdk.value.rpc}}
})
const io=fixtureSdk.value!
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const actor=id(3),point='735123456789012344',otherPoint='735123456789012351'
type Variant='L'|'LK'
type State='valid'|'missing'|'invalid'
type Declaration='valid'|'missing'|'duplicate'|'malformed'|'header'|'other-object'
function fixture(options:{variant?:Variant;constant?:State;digits?:State;declaration?:Declaration;value259?:string;poison?:boolean}={}){
 const variant=options.variant??'L',declaration=options.declaration??'valid'
 const reading=(qualifier:string,state:State='valid',value:string):Parts[]=>state==='missing'?[]:characteristic(qualifier,value,state==='invalid'?0:3)
 const bodyFor=(objectId:string,index:number,own259:Declaration):Parts[]=>[
  line(String(index+1),objectId,undefined,'9'),['DTM',['92','202610150000','203']],['DTM',['354','15','806']],qty('1000'),
  ...characteristic('Z13',variant==='L'?'Z22':'Z23'),...characteristic('Z04','Z04'),...characteristic('Z07','Z12'),
  ...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
  ...reading('Z02',options.constant,'1'),...reading('Z05',options.digits,'6'),
  ...(own259==='valid'||own259==='duplicate'?reading('Z16','valid',options.value259??'101'):
    own259==='malformed'?reading('Z16','invalid','101'):[]),
  ...(own259==='duplicate'?reading('Z16','valid','101'):[]),
  ['RFF',['MG',`METER-${objectId}`]],['RFF',['Z05','TES']],['RFF',['LI',`OWN-${index+1}`]],
  ['NAD','UD',['199001011234','SE2','260'],'','Synthetic Customer','Street','City','','12345','SE'],
  ['NAD','IT',[objectId,'','9'],'','','Street','City','','12345','SE'],['NAD','Z02',['99876','160','SVK']],
 ]
 const body:Parts[]=[['NAD','FR',['54321','160','SVK']],['NAD','DO',['12345','160','SVK']],
  ...(declaration==='header'?reading('Z16','valid','101'):[]),...bodyFor(point,0,declaration),
  ...(declaration==='other-object'?bodyFor(otherPoint,1,'valid'):[])]
 const raw=guideOrderedFixtureRaw(body,'Z04').replace('+S+R+','+54321:14+12345:14+')
  .replace("+23-DDQ-PRODAT'","+23-DDQ-PRODAT++1++1'")
 const source=prodatOwnSourceReadingMessage(raw)
 if(options.poison!==undefined){source.parsed_payload={meterReadingsSentInUtilts:options.poison,
  prodatDependentFacts:{meterReadingsSentInUtilts:options.poison,byCell:{'Z04:214':options.poison,'Z04:218':options.poison,'Z04:259':options.poison}}}
  source.validation_report={prodatDependentFacts:{meterReadingsSentInUtilts:options.poison}}}
 installProdatOwnSourceReadingFixture(io,source,variant)
 return source
}
beforeEach(()=>{
 resetProdatOwnSourceReadingSdk(io)
 const rpc=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){
   io.calls.push({kind:'rpc',name,args:{...args}})
   return {data:null,error:new Error('DECLARED_CATALOGUE_GATE_REFUSED_NO_PRIVATE_RECEIPT')}
  }
  return rpc(name,args)
 })
})
const readingFields=['214','218','259']
for(const variant of ['L','LK'] as const){
 it(`${variant}: actual registry runtime freshly reads and redeems own259101 at compiled policy`,async()=>{
  const source=fixture({variant})
  expect(validateEdifactSyntax(source)).toMatchObject({ok:true,grammarQualification:'qualified'})
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
  expect(io.calls.some(call=>call.name==='ediel_require_inbound_legal_context_v1')).toBe(true)
  expect(io.calls.some(call=>call.name==='ediel_inbound_reception_request_v1')).toBe(true)
  expect(decision.policy?.prodatDependentFacts?.registerObjects).toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:true}])
  const conditions=decision.policy?.prodatDependentConditions.filter(condition=>readingFields.includes(condition.fieldNumber))
  expect(conditions).toHaveLength(3);expect(conditions?.every(condition=>condition.status==='required')).toBe(true)
  expect(io.calls.some(call=>call.name==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(true)
  expect(decision.applicationDecision).not.toBe('accepted')
  expect(readReceivedCanonicalProdatResponseValidation(decision,source)).toBeNull()
  expect(readReceivedCanonicalProdatApplicationObjects(decision,source)).toBeNull()
  expect(readReceivedCanonicalProdatSourceFunction(decision,source)).toBeNull()
 })
}

function noPrivateAuthority(decision:Awaited<ReturnType<typeof resolveCanonicalRuntimeDecisionWithRegistry>>,source:EdielMessageRow){
 expect(readReceivedCanonicalProdatResponseValidation(decision,source)).toBeNull()
 expect(readReceivedCanonicalProdatApplicationObjects(decision,source)).toBeNull()
 expect(readReceivedCanonicalProdatSourceFunction(decision,source)).toBeNull()
}
for(const variant of ['L','LK'] as const){
 for(const field of ['214','218'] as const)for(const state of ['missing','invalid'] as const){
  it(`${variant}: own259 TRUE preserves actual typed ${field} ${state} in its own physical scope`,async()=>{
   const source=fixture({variant,...(field==='214'?{constant:state}:{digits:state})})
   const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
   expect(decision.policy?.prodatDependentFacts?.registerObjects?.[0]?.meterReadingsSentInUtilts).toBe(true)
   const errors=decision.responsePlan.filter(plan=>plan.family==='APERAK'&&plan.outcome==='negative').flatMap(plan=>plan.applicationErrors??[])
   expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:field,ercCode:state==='missing'?'41':'42',
    prodatFieldDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field,errorKind:state,
     occurrence:expect.objectContaining({objectId:point,identityAgency:'9',lineItemReference:'OWN-1'})})})]))
   expect(decision.issues.filter(issue=>issue.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED'&&issue.prodatDiagnostic?.kind==='field'
    &&readingFields.includes(issue.prodatDiagnostic.fieldNumber))).toEqual([])
   noPrivateAuthority(decision,source)
  })
 }
 for(const declaration of ['missing','duplicate','malformed','header','other-object'] as const){
  it(`${variant}: ${declaration}259 keeps the own declaration UNKNOWN instead of borrowing TRUE/FALSE`,async()=>{
   const source=fixture({variant,declaration,poison:true})
   const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
   expect(decision.policy?.prodatDependentFacts?.registerObjects?.find(row=>row.meteringPointId===point))
    .toEqual({meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:null})
   if(declaration==='other-object')expect(decision.policy?.prodatDependentFacts?.registerObjects?.find(row=>row.meteringPointId===otherPoint)?.meterReadingsSentInUtilts).toBe(true)
   expect(decision.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBeUndefined()
   expect(decision.policy?.prodatDependentConditions.filter(condition=>readingFields.includes(condition.fieldNumber)).every(condition=>condition.status==='undetermined')).toBe(true)
   noPrivateAuthority(decision,source)
  })
 }
 for(const poison of [true,false]){
  it(`${variant}: actorless registry and synchronous calls ignore caller/report/root ${poison} and fake internal token`,async()=>{
   const source=fixture({variant,poison})
   const facts={admissionAt:source.message_received_at!,ownSourceReadingContext:Object.freeze({}),ownSourceReadingActorUserId:actor}
   const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,facts),sync=resolveCanonicalRuntimeDecision(source,facts)
   for(const result of [decision,sync]){
    expect(result.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
    expect(result.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBeUndefined()
    expect(result.policy?.prodatDependentConditions.filter(condition=>readingFields.includes(condition.fieldNumber)).every(condition=>condition.status==='undetermined')).toBe(true)
    noPrivateAuthority(result,source)
   }
   expect(io.calls.some(call=>['ediel_require_inbound_legal_context_v1','ediel_inbound_reception_request_v1','gridex_actor_has_company_permission'].includes(call.name))).toBe(false)
  })
 }
 it(`${variant}: the original receipt microsecond governs source declaration admission`,async()=>{
  const source=fixture({variant})
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor,admissionAt:'2026-10-01T12:01:00.123457Z'})
  expect(decision.policy).toBeNull()
  expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'CANONICAL_POLICY_RESOLUTION_FAILED',description:'prodat_source_readings_admission_clock_mismatch'})]))
  noPrivateAuthority(decision,source)
 })
}
const adverse:readonly [string,()=>void][]=[
 ['missing actual source',()=>{io.rows.ediel_messages=[]}],
 ['changed actual source raw',()=>{io.rows.ediel_messages[0].raw_payload='HOSTILE'}],
 ['wrong legal receiver',()=>{io.legal.legalEdielId='99999'}],
 ['missing source edition',()=>{delete io.legal.sourceEdition}],
 ['wrong reception hash',()=>{io.reception.canonicalPayloadHash='f'.repeat(64);io.reception.receivedPayloadHash='f'.repeat(64)}],
 ['missing first reception',()=>{io.reception={}}],
 ['different mail raw',()=>{io.rows.inbound_email_messages[0].raw_edifact_payload='FOREIGN'}],
 ['different parse raw',()=>{io.rows.inbound_ediel_parse_results[0].raw_payload='FOREIGN'}],
 ['foreign parse company',()=>{io.rows.inbound_ediel_parse_results[0].company_id=id(99)}],
]
it.each(adverse)('automatic %s refusal retains null context and never falls back to poisoned TRUE',async(_name,change)=>{
 const source=fixture({poison:true});change()
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
 expect(decision.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
 expect(decision.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBeUndefined()
 expect(decision.applicationDecision).not.toBe('accepted');noPrivateAuthority(decision,source)
})
it.each(['ediel_messages','inbound_email_messages','inbound_ediel_parse_results'])('actual %s transport failure remains thrown and produces no replacement authority',async(table)=>{
 const source=fixture(),error=new Error('DECLARED_SOURCE_READ_STOP')
 io.tableErrors[table]=error
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toBe(error)
 expect(io.calls.some(call=>call.name==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(false)
})
it.each(['ediel_require_inbound_legal_context_v1','ediel_inbound_reception_request_v1'])('actual %s transport failure remains thrown before policy/registry success',async(rpc)=>{
 const source=fixture(),error=new Error('DECLARED_SOURCE_RPC_STOP')
 io.rpcErrors[rpc]=error
 if(rpc==='ediel_require_inbound_legal_context_v1')await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toThrow('ediel_inbound_legal_context_required')
 else await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toBe(error)
 expect(io.calls.some(call=>call.name==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(false)
})
it('current execution permission quarantine remains thrown before legal/source authority',async()=>{
 const source=fixture();io.permissions.clear()
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toMatchObject({disposition:{kind:'security_quarantine'}})
 expect(io.calls.some(call=>call.name==='ediel_require_inbound_legal_context_v1')).toBe(false)
})
it('a genuine invocation rechecks permission after mail/parse reads and refuses revocation',async()=>{
 const source=fixture();io.revokeAfter=1
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toMatchObject({disposition:{kind:'security_quarantine'}})
 expect(io.calls.some(call=>call.name==='inbound_ediel_parse_results')).toBe(true)
 expect(io.calls.some(call=>call.name==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(false)
})
it('repeated actual runtime invocation performs another current source/actor READ rather than reusing a redeemed token',async()=>{
 const source=fixture()
 const first=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
 expect(first.policy?.prodatDependentFacts?.registerObjects?.[0]?.meterReadingsSentInUtilts).toBe(true)
 expect(io.calls.filter(call=>call.name==='ediel_require_inbound_legal_context_v1')).toHaveLength(1)
 io.permissions.clear()
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toMatchObject({disposition:{kind:'security_quarantine'}})
 expect(io.calls.filter(call=>call.name==='ediel_require_inbound_legal_context_v1')).toHaveLength(1)
})
it('invalid international grammar reaches no lazy actor getter or OwnSource authority reads',async()=>{
 const source=fixture();source.raw_payload=source.raw_payload!.replace('UNT+','UNT+999')
 const facts={get actorUserId():string{throw Error('FORBIDDEN_ACTOR_ACCESS_BEFORE_GRAMMAR')}}
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,facts)
 expect(decision.syntaxDecision).not.toBe('accepted');expect(io.calls).toEqual([])
 noPrivateAuthority(decision,source)
})
it('unused public reporting-context getter stays unread when only the fresh internal L source port is selected',async()=>{
 const source=fixture()
 const facts={actorUserId:actor,get receivedReportingContext():undefined{throw Error('UNUSED_PUBLIC_REPORTING_GETTER')}}
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,facts)
 expect(decision.policy?.prodatDependentFacts?.registerObjects?.[0]?.meterReadingsSentInUtilts).toBe(true)
 noPrivateAuthority(decision,source)
})

it('even a genuine externally loaded context cannot enter the actorless runtime through caller facts',async()=>{
 const source=fixture(),context=await loadProdatOwnSourceReadingContext(source,actor)
 expect(context).not.toBeNull();io.calls=[]
 const facts={admissionAt:source.message_received_at!,ownSourceReadingContext:context,ownSourceReadingActorUserId:actor}
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,facts)
 expect(decision.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
 expect(io.calls.some(call=>call.name==='ediel_require_inbound_legal_context_v1')).toBe(false)
 expect(sourceProdatOwnRegisterReadingDeclarations({message:source,actorUserId:actor,context,policy:decision.policy!})?.[0]?.meterReadingsSentInUtilts).toBe(true)
 noPrivateAuthority(decision,source)
})
