// Finite C source component; SDK transport/catalogue are synthetic.
// Real source issuance, actor/legal/reception checks, policy and field/register
// consumers execute. No native DB, APP/ACK receipt, SEND or whole acceptance.
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {loadProdatOwnSourceReadingContext,sourceProdatOwnRegisterReadingDeclarations} from '@/lib/ediel/core/prodatOwnSourceRegisterReadingDeclarations'
import {resolveCanonicalRuntimeDecisionWithRegistry,readReceivedCanonicalProdatResponseValidation,readReceivedCanonicalProdatApplicationObjects} from '@/lib/ediel/core/runtimeDecision'
import {resolveCanonicalMessagePolicy} from '@/lib/ediel/core/messagePolicy'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import {stockholmBusinessDate} from '@/lib/ediel/core/executionContext'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import type {ProdatIgnoredField} from '@/lib/ediel/rulebook/fieldMatrix'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic,line,qty,type Parts} from './fixtures/prodat-register'
import {installProdatOwnSourceReadingFixture,resetProdatOwnSourceReadingSdk,prodatOwnSourceReadingMessage,type ProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'

const sdk=vi.hoisted(()=>({value:null as ProdatOwnSourceReadingSdk|null}))
vi.mock('@/lib/supabase/service',async()=>{
 const {createProdatOwnSourceReadingSdk}=await import('./helpers/prodatOwnSourceReadingFixture')
 sdk.value=createProdatOwnSourceReadingSdk()
 return {supabaseService:{from:sdk.value.from,rpc:sdk.value.rpc}}
})
const io=sdk.value!,actor='00000000-0000-4000-8000-000000000003'
const point='735123456789012344',otherPoint='735123456789012351'
const readings=['214','218','259']
type Options={declaration?:'present'|'absent'|'invalid';at?:string;poison?:boolean;two?:boolean}
function fixture(options:Options={}){
 const bodyFor=(objectId:string,index:number):Parts[]=>[
  line(String(index+1),objectId,undefined,'9'),['DTM',['92','202610150000','203']],['DTM',['354','15','806']],qty('1000'),
  ...characteristic('Z13','Z24'),...characteristic('Z04','Z04'),...characteristic('Z07','Z12'),
  ...characteristic('Z12','D',3),...characteristic('Z15','Z31'),...characteristic('Z14','L639Q',3),
  ...characteristic('Z02','1',3),...characteristic('Z05','6',3),
  ...(options.declaration==='absent'?[]:characteristic('Z16',options.declaration==='invalid'?'INVALID':'101',3)),
  ['RFF',['MG','SYNTHETIC-METER']],['RFF',['Z05','TES']],['RFF',['LI',`OWN-${index+1}`]],
  ['NAD','UD',['199001011234','SE2','260'],'','Synthetic Customer','Street','City','','12345','SE'],
  ['NAD','IT',[objectId,'','9'],'','','Street','City','','12345','SE'],['NAD','Z02',['99876','160','SVK']],
 ]
 const body:Parts[]=[['NAD','FR',['54321','160','SVK']],['NAD','DO',['12345','160','SVK']],...bodyFor(point,0),...(options.two?bodyFor(otherPoint,1):[])]
 const raw=guideOrderedFixtureRaw(body,'Z04').replace('+S+R+','+54321:14+12345:14+').replace("+23-DDQ-PRODAT'","+23-DDQ-PRODAT++1++1'")
 const source=prodatOwnSourceReadingMessage(raw),received=options.at??source.message_received_at!
 if(options.at){
  source.message_received_at=received;source.created_at=received
  const snapshot=source.execution_context_snapshot
  if(!snapshot||typeof snapshot!=='object'||!('receivedProdatContext' in snapshot))throw Error('EXPECTED_GENUINE_BIRTH')
  const born=snapshot.receivedProdatContext
  if(!born||typeof born!=='object'||!('sourceReceivedAt' in born)||!('capturedAt' in born))throw Error('EXPECTED_GENUINE_BIRTH_FIELDS')
  born.sourceReceivedAt=received;born.capturedAt=received
 }
 if(options.poison!==undefined){source.parsed_payload={meterReadingsSentInUtilts:options.poison,prodatDependentFacts:{meterReadingsSentInUtilts:options.poison,byCell:{'Z04:214':options.poison,'Z04:218':options.poison,'Z04:259':options.poison}}}
  source.validation_report={prodatDependentFacts:{meterReadingsSentInUtilts:options.poison,byCell:{'Z04:214':options.poison,'Z04:218':options.poison,'Z04:259':options.poison}}}}
 installProdatOwnSourceReadingFixture(io,source,'C',{actorUserId:actor,receivedAt:received,
  mailId:source.inbound_email_message_id!,parseId:'00000000-0000-4000-8000-000000000005',
  receptionId:'00000000-0000-4000-8000-000000000006',legalActorId:'00000000-0000-4000-8000-000000000008'})
 return source
}
function selected(source:EdielMessageRow){
 const canonical=parseCanonicalMessageRow(source)
 return resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z04',subtypeOrReasonCode:canonical.subtype,
  direction:'inbound',referenceDate:stockholmBusinessDate(new Date(source.message_received_at!)),
  associationAssignedCode:canonical.version,applicationReference:canonical.applicationReference,mode:'parse'})
}
function registerUnknown(decision:Awaited<ReturnType<typeof resolveCanonicalRuntimeDecisionWithRegistry>>){
 expect(decision.issues.filter(item=>item.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED'
  &&item.prodatDiagnostic?.kind==='local_unknown'&&item.prodatDiagnostic.sourceRule==='PRODAT26A:register-readings')).toHaveLength(3)
}
function noPrivateAuthority(decision:Awaited<ReturnType<typeof resolveCanonicalRuntimeDecisionWithRegistry>>,source:EdielMessageRow){
 expect(readReceivedCanonicalProdatResponseValidation(decision,source)).toBeNull()
 expect(readReceivedCanonicalProdatApplicationObjects(decision,source)).toBeNull()
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
for(const declaration of ['present','absent'] as const){
 it(`C qualified runtime: ${declaration}259 does not promise follow-up readings`,async()=>{
  const source=fixture({declaration,poison:true}),original=structuredClone(source)
  expect(validateEdifactSyntax(source)).toMatchObject({ok:true,grammarQualification:'qualified'})
  const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
  expect(decision.policy?.prodatDependentFacts?.registerObjects).toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:false}])
  expect(decision.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBeUndefined()
  const conditions=decision.policy?.prodatDependentConditions.filter(item=>readings.includes(item.fieldNumber))
  expect(conditions).toHaveLength(3);expect(conditions?.every(item=>item.status==='not_required')).toBe(true)
  expect(decision.issues.filter(item=>item.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED'&&item.prodatDiagnostic?.kind==='local_unknown')).toEqual([])
  expect(decision.prodatIgnoredFields?.filter(item=>item.fieldNumber==='259')).toHaveLength(declaration==='present'?1:0)
  expect(source).toEqual(original)
  expect(io.calls.filter(call=>call.name==='ediel_require_inbound_legal_context_v1')).toHaveLength(1)
  expect(io.calls.filter(call=>call.name==='ediel_inbound_reception_request_v1')).toHaveLength(1)
  expect(decision.applicationDecision).not.toBe('accepted');noPrivateAuthority(decision,source)
 })
}
it('C dated process: each genuine object receives its own FALSE without inventory fabrication',async()=>{
 const source=fixture({two:true}),context=await loadProdatOwnSourceReadingContext(source,actor)
 expect(context).not.toBeNull()
 const objects=sourceProdatOwnRegisterReadingDeclarations({message:source,actorUserId:actor,context,policy:selected(source)})
 expect(objects).toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:false},
  {meteringPointId:otherPoint,identityAgency:'9',meterReadingsSentInUtilts:false}])
 expect(objects?.every(item=>item.expectedRegisterCount===undefined)).toBe(true)
})
it('C P119 reception: forbidden supplied259 is preserved as ignored, including extra invalid content',async()=>{
 const source=fixture({declaration:'invalid'}),context=await loadProdatOwnSourceReadingContext(source,actor),canonical=parseCanonicalMessageRow(source)
 expect(context).not.toBeNull()
 const policy=resolveCanonicalMessagePolicy(source,canonical,{ownSourceReadingActorUserId:actor,ownSourceReadingContext:context})!
 expect(policy.prodatDependentFacts?.registerObjects?.[0]?.meterReadingsSentInUtilts).toBe(false)
 const ignored:ProdatIgnoredField[]=[]
 const issues=validateCanonicalPolicyFields({policy,rawPayload:source.raw_payload,rawSegments:canonical.rawSegments,una:canonical.una,onIgnoredField:item=>ignored.push(item)})
 expect(ignored).toEqual(expect.arrayContaining([expect.objectContaining({fieldNumber:'259',sourceRule:'PRODAT26A:P119',occurrence:expect.objectContaining({objectId:point,identityAgency:'9',lineItemReference:'OWN-1'})})]))
 expect(issues.filter(item=>item.prodatDiagnostic?.kind==='field'&&item.prodatDiagnostic.fieldNumber==='259')).toEqual([])
 expect(source.raw_payload).toContain('INVALID')
})
for(const poison of [true,false]){
 it(`C actorless/root/report ${poison} cannot manufacture qualified FALSE or TRUE`,async()=>{
  const source=fixture({poison}),decision=await resolveCanonicalRuntimeDecisionWithRegistry(source)
  expect(decision.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
  expect(decision.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBeUndefined()
  expect(decision.policy?.prodatDependentConditions.filter(item=>readings.includes(item.fieldNumber)).every(item=>item.status==='undetermined')).toBe(true)
 registerUnknown(decision)
  expect(io.calls.some(call=>call.name==='ediel_require_inbound_legal_context_v1')).toBe(false)
  noPrivateAuthority(decision,source)
 })
}
it('C source received before the dated26B premise stays UNKNOWN with poisoned false hints',async()=>{
 const source=fixture({at:'2026-09-30T21:59:59.999999Z',poison:false})
 expect(await loadProdatOwnSourceReadingContext(source,actor)).toBeNull()
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
 expect(decision.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
 expect(decision.policy?.prodatDependentConditions.filter(item=>readings.includes(item.fieldNumber)).every(item=>item.status==='undetermined')).toBe(true)
 registerUnknown(decision)
 noPrivateAuthority(decision,source)
})
it('C Stockholm effective date begins at local midnight with unchanged original microseconds',async()=>{
 const source=fixture({at:'2026-09-30T22:00:00.000000Z'}),context=await loadProdatOwnSourceReadingContext(source,actor)
 expect(context).not.toBeNull()
 expect(sourceProdatOwnRegisterReadingDeclarations({message:source,actorUserId:actor,context,policy:selected(source)})?.[0]?.meterReadingsSentInUtilts).toBe(false)
})
const adverse:readonly [string,()=>void][]=[
 ['missing stored source',()=>{io.rows.ediel_messages=[]}],
 ['stored raw changed',()=>{io.rows.ediel_messages[0].raw_payload='HOSTILE'}],
 ['stored company changed',()=>{io.rows.ediel_messages[0].company_id='00000000-0000-4000-8000-000000000099'}],
 ['stored environment changed',()=>{io.rows.ediel_messages[0].environment='production'}],
 ['wrong source hash',()=>{const snapshot=io.rows.ediel_messages[0].execution_context_snapshot as Record<string,unknown>;const born=snapshot.receivedProdatContext as Record<string,unknown>;born.payloadHash='f'.repeat(64)}],
 ['wrong legal subtype',()=>{io.legal.subtype='L'}],
 ['wrong legal receiver',()=>{io.legal.legalEdielId='99999'}],
 ['wrong legal reason',()=>{(io.legal.canonicalProjection as Record<string,unknown>).transactionReasonCode='Z22'}],
 ['missing source edition',()=>{delete io.legal.sourceEdition}],
 ['missing first reception',()=>{io.reception={}}],
 ['actual protocol duplicate',()=>{io.reception.classification='protocol_duplicate';io.reception.status='held';io.reception.reason='protocol_duplicate';io.reception.responseRequestId='00000000-0000-4000-8000-000000000097'}],
 ['wrong reception hash',()=>{io.reception.canonicalPayloadHash='f'.repeat(64);io.reception.receivedPayloadHash='f'.repeat(64)}],
 ['different mail raw',()=>{io.rows.inbound_email_messages[0].raw_edifact_payload='FOREIGN'}],
 ['different parse raw',()=>{io.rows.inbound_ediel_parse_results[0].raw_payload='FOREIGN'}],
 ['foreign parse company',()=>{io.rows.inbound_ediel_parse_results[0].company_id='00000000-0000-4000-8000-000000000099'}],
]
it.each(adverse)('C %s: authentic guarded refusal remains UNKNOWN despite false report',async(_name,change)=>{
 const source=fixture({poison:false});change()
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})
 expect(decision.policy?.prodatDependentFacts?.registerObjects).toBeUndefined()
 expect(decision.policy?.prodatDependentFacts?.meterReadingsSentInUtilts).toBeUndefined()
 expect(decision.policy?.prodatDependentConditions.filter(item=>readings.includes(item.fieldNumber)).every(item=>item.status==='undetermined')).toBe(true)
 registerUnknown(decision)
 noPrivateAuthority(decision,source)
})
it('C malformed replay receipt stays thrown before source/policy replacement',async()=>{
 const source=fixture({poison:false});io.reception.classification='replay'
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toThrow('ediel_reception_result_invalid')
 expect(io.calls.some(call=>call.name==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(false)
})
it('C wrong execution actor is security quarantine before protected legal reads',async()=>{
 const source=fixture()
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:'00000000-0000-4000-8000-000000000099'})).rejects.toMatchObject({disposition:{kind:'security_quarantine'}})
 expect(io.calls.some(call=>call.name==='ediel_require_inbound_legal_context_v1')).toBe(false)
})
it('C revocation between genuine mail/parse reads and token issuance still quarantines',async()=>{
 const source=fixture();io.revokeAfter=1
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(source,{actorUserId:actor})).rejects.toMatchObject({disposition:{kind:'security_quarantine'}})
 expect(io.calls.some(call=>call.name==='inbound_ediel_parse_results')).toBe(true)
})
it('C cloned, wrong-actor and redeemed genuine contexts never supply another invocation',async()=>{
 const source=fixture(),first=await loadProdatOwnSourceReadingContext(source,actor)
 if(!first)throw Error('EXPECTED_GENUINE_C_CONTEXT')
 expect(sourceProdatOwnRegisterReadingDeclarations({message:source,actorUserId:actor,context:Object.freeze({...first}),policy:selected(source)})).toBeNull()
 expect(sourceProdatOwnRegisterReadingDeclarations({message:source,actorUserId:'00000000-0000-4000-8000-000000000099',context:first,policy:selected(source)})).toBeNull()
 expect(sourceProdatOwnRegisterReadingDeclarations({message:source,actorUserId:actor,context:first,policy:selected(source)})).toBeNull()
 const fresh=await loadProdatOwnSourceReadingContext(source,actor)
 expect(sourceProdatOwnRegisterReadingDeclarations({message:source,actorUserId:actor,context:fresh,policy:selected(source)})?.[0]?.meterReadingsSentInUtilts).toBe(false)
 expect(sourceProdatOwnRegisterReadingDeclarations({message:source,actorUserId:actor,context:fresh,policy:selected(source)})).toBeNull()
})
it('C original tampering exhausts the genuine context while preserving raw/source guards',async()=>{
 const source=fixture(),context=await loadProdatOwnSourceReadingContext(source,actor)
 expect(context).not.toBeNull()
 expect(sourceProdatOwnRegisterReadingDeclarations({message:{...source,raw_payload:source.raw_payload!+' '},actorUserId:actor,context,policy:selected(source)})).toBeNull()
 expect(sourceProdatOwnRegisterReadingDeclarations({message:source,actorUserId:actor,context,policy:selected(source)})).toBeNull()
})
it('C admission clock mismatch cannot choose the new rule for a different original receipt',async()=>{
 const source=fixture(),context=await loadProdatOwnSourceReadingContext(source,actor)
 expect(()=>resolveCanonicalMessagePolicy(source,parseCanonicalMessageRow(source),{admissionAt:'2026-10-01T12:01:00.123457Z',ownSourceReadingActorUserId:actor,ownSourceReadingContext:context})).toThrow('prodat_source_readings_admission_clock_mismatch')
})
