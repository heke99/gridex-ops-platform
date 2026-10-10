import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
// Finite H structural-field producer regression. Actual syntax, runtime, actor,
// source/legal/catalog decoders and negative renderer execute. Database READs
// are explicitly synthetic; the actual canonical writer attempt is refused.
// No accepted ledger, business capability, native source, ACK or receipt is made.
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {ownerId,ownerRows,ownerSource,ownerRulePack} from '@/__tests__/helpers/sourceOwnerFixtures'
import {withProdatFixtureInsertContext} from '@/__tests__/helpers/prodatInboundSourceFixture'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {resolveCanonicalRuntimeDecisionWithRegistry,readReceivedCanonicalProdatResponseValidation,
 readReceivedCanonicalProdatApplicationObjects,readReceivedCanonicalProdatSourceFunction} from '@/lib/ediel/core/runtimeDecision'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {requireEdielInboundLegalContext} from '@/lib/ediel/tenant/sourceLegalContext'
import {resolveCanonicalRulePack} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {loadReceivedZ04HStructuralFieldRejection,ownReceivedZ04HStructuralFieldRejection,readReceivedZ04HStructuralFieldWitness,
 hasReceivedZ04HStructuralFieldRejection,observeReceivedZ04HStructuralFields} from '@/lib/ediel/prodat/receivedZ04HStructuralFieldRejection'

type Row=Record<string,unknown>
const io=vi.hoisted(()=>({source:{} as EdielMessageRow,rows:{} as Record<string,Row[]>,
 calls:[] as {name:string;args:Row}[],writes:[] as {port:string;value:Row}[],status:null as Row|null,
 legal:null as Row|null,registry:[] as Row[],sourceReadError:false,legalReadError:false,registryReadError:false,
 permission:true,readDelayMs:0,bilateralError:null as unknown,
 bornSourceId:'',sourceQueryFilters:[] as {key:string;value:unknown}[],
 actorReadHook:null as (()=>void)|null,originalReadHook:null as (()=>void)|null}))
const actor=ownerId(50),company=ownerId(2),foreign=ownerId(999)
const result=(data:unknown,error:unknown=null)=>{const p=Promise.resolve({data,error});return Object.assign(p,{abortSignal:()=>p})}
const stop=()=>new Error('DECLARED_FIRST_STATUS_BOUNDARY_NO_PERSISTENCE')
function rpc(name:string,args:Row){
 io.calls.push({name,args:structuredClone(args)})
 if(name==='ediel_read_prodat_bilateral_source_capability_v1')return result(null,io.bilateralError)
 if(name==='ediel_require_inbound_legal_context_v1'){
  expect(args).toEqual({p_company_id:company,p_message_id:io.bornSourceId})
  if(io.readDelayMs)vi.setSystemTime(new Date(Date.now()+io.readDelayMs))
  return result(structuredClone(io.legal),io.legalReadError?new Error('DECLARED_REQUIRED_START_LEGAL_READ_REFUSED'):null)
 }
 if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){
  expect(args).toMatchObject({p_market:'electricity',p_family:'PRODAT',p_message_code:'Z04',p_direction:'inbound'})
  return result(structuredClone(io.registry),io.registryReadError?new Error('DECLARED_REQUIRED_START_REGISTRY_READ_REFUSED'):null)
 }
 if(name==='ediel_read_technical_source_endpoint_v2')return result(null)
 if(name==='gridex_actor_has_company_permission'){
  const allowed=io.permission&&args.p_company_id===company&&args.p_actor_user_id===actor&&
   ['communication.read','communication.write','ediel_testing.write'].includes(String(args.p_permission))
  const hook=io.actorReadHook;io.actorReadHook=null;hook?.()
  return result(allowed)
 }
 if(name==='ediel_list_business_acks_for_source_v1')return result({version:1,companyId:company,sourceMessageId:io.source.id,
  environment:io.source.environment,ackFamily:args.p_ack_family??null,messages:[]})
 if(name==='gridex_read_outbound_acks_for_source_v2')return result({version:2,executionActorUserId:actor,executionPhase:args.p_phase,
  sourceMessageId:io.source.id,sourcePayloadHash:evidenceHash(io.source.raw_payload!),
  companyId:company,environment:io.source.environment,originals:[]})
 if(name==='ediel_apply_customer_life_event_source_v1')return result({applied:false,reason:'not_customer_life_event'})
 if(name==='gridex_record_prodat_source_validation_v6'){
  io.writes.push({port:name,value:structuredClone(args)})
  return result(null,new Error('DECLARED_CANONICAL_WRITE_REFUSED_NO_RECEIPT'))
 }
 throw Error('UNDECLARED_REQUIRED_START_RPC:'+name)
}
function table(name:string){
 if(!Object.hasOwn(io.rows,name))throw Error('UNDECLARED_REQUIRED_START_TABLE:'+name)
 const predicates:((row:Row)=>boolean)[]=[]
 let columns='*'
 const read=(single=false)=>{
  const data=io.rows[name].filter(row=>predicates.every(fn=>fn(row))).map(row=>columns==='*'?structuredClone(row):
   Object.fromEntries(columns.split(',').map(key=>[key,row[key]])))
  return {data:single?data[0]??null:data,error:name==='ediel_messages'&&io.sourceReadError?
   new Error('DECLARED_REQUIRED_START_ORIGINAL_READ_REFUSED'):null,count:data.length}
 }
 const q={select:(value='*')=>{columns=value;return q},eq:(key:string,value:unknown)=>{
  if(name==='ediel_messages')io.sourceQueryFilters.push({key,value})
  predicates.push(row=>row[key]===value);return q},
  not:(key:string,op:string,value:unknown)=>{if(op!=='is')throw Error('UNDECLARED_REQUIRED_START_NOT');predicates.push(row=>row[key]!==value);return q},
  lte:()=>q,or:()=>q,limit:()=>q,abortSignal:()=>q,
  update:(value:Row)=>{io.writes.push({port:'table:'+name,value:structuredClone(value)});return q},
  maybeSingle:async()=>read(true),single:async()=>{
   const result=read(true)
   if(name==='ediel_messages'){const hook=io.originalReadHook;io.originalReadHook=null;hook?.()}
   return result
  },
  then:(resolve:(value:ReturnType<typeof read>)=>unknown)=>Promise.resolve(read()).then(resolve)}
 return q
}
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(name:string,args:Row)=>rpc(name,args),from:(name:string)=>table(name)}}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async(id:string)=>id===io.source.id?structuredClone(io.source):null,
 updateEdielMessageStatus:async(value:Row)=>{io.status=structuredClone(value);throw stop()},
 createEdielMessageEvent:async(value:Row)=>{io.writes.push({port:'event',value:structuredClone(value)});return {id:'declared-event'}},
 linkEdielMessage:async()=>{throw Error('UNEXPECTED_LINK_WRITE')},listAckMessagesForSource:async()=>[],
 getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[],
}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:async()=>{throw Error('UNEXPECTED_ACK_WRITE')}}))
vi.mock('@/lib/ediel/outbox/createOutboxItem',()=>({createOutboxItem:async()=>{throw Error('UNEXPECTED_OUTBOX_WRITE')}}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>null}))
vi.mock('@/lib/ediel/inboundCases',()=>({createOrUpdateInboundProdatCase:async()=>{throw Error('UNEXPECTED_CASE_WRITE')}}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))

type Field='209'|'314'
function message(field:Field|null='209'):EdielMessageRow{
 const original=ownerSource(),wire=tokenizeEdifact(original.raw_payload!)
 const parts=wire.segments.map(segment=>segment.tag==='LIN'
  ?field==='209'?segment.raw.replace('735123456789012345',''):field==='314'?segment.raw.replace('LIN+1++','LIN+++'):segment.raw
  :segment.tag==='CAV'&&segmentComposite(segment,1,wire.una)[0]==='Z22'?segment.raw.replace('Z22','Z25'):segment.raw)
 const start=parts.findIndex(segment=>segment.startsWith('UNH+')),end=parts.findIndex(segment=>segment.startsWith('UNT+'))
 parts[end]=`UNT+${end-start+1}+M`
 return withProdatFixtureInsertContext({...original,raw_payload:"UNA:+.? '"+parts.join("'")+"'",
  message_version:'E2SE6A',message_created_at:'2026-09-17T12:00:00Z',parsed_payload:{},customer_id:null,site_id:null,metering_point_id:null})
}
function setSource(source:EdielMessageRow){
 io.source=source;io.rows=ownerRows();io.rows.ediel_messages=[structuredClone(source) as unknown as Row]
 io.rows.customers=[{id:ownerId(3),company_id:company},{id:ownerId(903),company_id:foreign}]
 io.rows.metering_permissions=[{id:ownerId(904),company_id:company,status:'pending'},{id:ownerId(905),company_id:foreign,status:'active'}]
 for(const name of ['ediel_actor_settings','ediel_route_profiles','communication_routes'])io.rows[name]=[]
 io.calls=[];io.writes=[];io.status=null;io.legal=null;io.registry=[]
 io.sourceReadError=false;io.legalReadError=false;io.registryReadError=false;io.permission=true;io.readDelayMs=0;io.bilateralError=null
 io.bornSourceId=source.id;io.sourceQueryFilters=[];io.actorReadHook=null;io.originalReadHook=null
}
/** These are declared immutable birth/legal/activation READ results, never a
 * business agreement or accepted ledger. The real public decoders below verify
 * them; the catalogue only compares the static named guide/profile. */
function qualified(field:Field|null='209'){
 const registry=ownerRulePack(),profileKey='PRODAT:Z04:H:26.A:r3'
 const profile={...registry.profile,transactionSubtype:'H',reasonForTransaction:'Z25'}
 const rulePack=structuredClone(registry.original_snapshot.rulePack)
 const messageProfile={...registry.original_snapshot.messageProfile,profile_key:profileKey,profile}
 const snapshot={rulePack,messageProfile,guideSources:[]}
 const row=message(field),tokens=tokenizeEdifact(row.raw_payload!).segments.map(segment=>segment.raw)
 const unb=tokens.findIndex(segment=>segment.startsWith('UNB+'))
 tokens[unb]+='++1++1' // Declared test source agrees with its physical UNB.
 const raw="UNA:+.? '"+tokens.join("'")+"'"
 setSource(withProdatFixtureInsertContext({...row,raw_payload:raw,canonical_rule_pack_id:registry.rule_pack_id,
  rule_profile_key:profileKey,rule_profile_version_id:registry.message_profile_id,rule_profile_version:registry.original_version,
  rule_pack_checksum:registry.source_hash,rule_pack_snapshot:{...snapshot,profileKey,profileVersionId:registry.message_profile_id,
   version:registry.original_version,checksum:registry.source_hash}}))
 io.registry=[{...registry,profile_key:profileKey,profile,original_snapshot:structuredClone(snapshot)}]
 io.legal={basisKind:'observed_source_persistence',companyId:company,environment:'test',direction:'inbound',family:'PRODAT',
  code:'Z04',subtype:'H',legalActorId:ownerId(9),legalEdielId:'54321',actorRole:'electricity_supplier',
  // This opaque legal catalogue edition is distinct from the born pack checksum.
  transportActorId:ownerId(9),transportEdielId:'54321',applicationReference:'23-DDQ-PRODAT',sourceEdition:'c'.repeat(64),
  canonicalProjection:{family:'PRODAT',code:'Z04',subtype:'H',transactionReasonCode:'Z25',direction:'inbound',
   senderRoles:['grid_owner'],receiverRoles:['supplier'],applicationReferences:['23-DDQ-PRODAT']},
  observedAt:io.source.message_received_at,sourceReceivedAt:io.source.message_received_at,facts:{profile:io.rows.tenant_ediel_profiles[0],
   identifiers:io.rows.tenant_actor_identifiers,roles:io.rows.tenant_actor_roles,transportRelation:null,transportIdentifiers:null}}
}

beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-30T13:00:00Z'));qualified()})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
const fields=['209','314'] as const
const response=(decision:Awaited<ReturnType<typeof resolveCanonicalRuntimeDecisionWithRegistry>>)=>readReceivedCanonicalProdatResponseValidation(decision,io.source)
it.each(fields)('actorless physical H%s observation cannot mint a response or business capability',async field=>{
 qualified(field);expect(validateEdifactSyntax(io.source).ok).toBe(true)
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source)
 expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field,errorKind:field==='314'?'missing':'invalid'})})]))
 expect(decision.policy).toBeNull();expect(decision.applicationDecision).not.toBe('accepted')
 expect(response(decision)).toBeNull();expect(readReceivedCanonicalProdatApplicationObjects(decision,io.source)).toBeNull()
 expect(readReceivedCanonicalProdatSourceFunction(decision,io.source)).toBeNull()
 expect(io.calls.some(call=>call.name==='gridex_actor_has_company_permission')).toBe(false);expect(io.writes).toEqual([])
})
it.each(fields)('actual actor-qualified H%s missing owns only exact typed defect with actual available references',async field=>{
 qualified(field);const before=structuredClone({source:io.source,graphs:io.rows})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 expect(decision).toMatchObject({policy:null,syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'not_applicable'})
 expect(response(decision)?.responses).toEqual([expect.objectContaining({scope:field==='314'?'message':'object',ercCode:field==='314'?'41':'42',fieldCode:field,id:field==='314'?'735123456789012345':null,li:'CASE-1'})])
 expect(readReceivedCanonicalProdatApplicationObjects(decision,io.source)).toBeNull();expect(readReceivedCanonicalProdatSourceFunction(decision,io.source)).toBeNull()
 expect(bindReceivedRegisterValidation(decision.prodatRegisterValidation,io.source.raw_payload!)).not.toBeNull()
 const evidence=buildReceivedSourceValidationEvidence({original:io.source,validated:io.source,resolvedCompanyId:company,decision})
 expect(evidence?.prodatResponseValidation).toEqual(response(decision));expect(evidence?.prodatObjectValidation).toBeUndefined()
 expect(evidence?.prodatApplicationValidation).toBeUndefined();expect(evidence?.prodatSourceFunctionValidation).toBeUndefined()
 expect(io.writes).toEqual([]);expect({source:io.source,graphs:io.rows}).toEqual(before)
})
it.each(fields)('public receiver H%s attempts actual negative canonical writer and halts at its refusal',async field=>{
 qualified(field);const before=structuredClone({source:io.source,graphs:io.rows})
 const error=await processInboundEdielMessage({actorUserId:actor,edielMessageId:io.source.id}).catch(error=>error)
 expect(error?.message).toBe('prodat_canonical_source_validation_unconfirmed')
 const writes=io.writes.filter(write=>write.port==='gridex_record_prodat_source_validation_v6');expect(writes).toHaveLength(1)
 expect(JSON.parse(String(writes[0].value.p_facts_text))).toMatchObject({applicationDecision:'rejected',functionalDecision:'not_applicable'})
 expect(JSON.parse(String(writes[0].value.p_response_facts_text)).responses).toEqual([expect.objectContaining({fieldCode:field,ercCode:field==='314'?'41':'42',li:'CASE-1'})])
 expect(writes[0].value.p_object_facts_text).toBeNull();expect(writes[0].value.p_application_facts_text).toBeNull();expect(writes[0].value.p_source_function_facts_text).toBeNull()
 expect(io.status).toBeNull();expect({source:io.source,graphs:io.rows}).toEqual(before)
})
it.each(['copy','wrong actor','expired','changed source'] as const)('private READ token refuses %s redemption',async adverse=>{
 const token=await loadReceivedZ04HStructuralFieldRejection(io.source,actor);expect(token).not.toBeNull()
 expect(readReceivedZ04HStructuralFieldWitness(token!,io.source,actor)).not.toBeNull()
 const candidate=adverse==='copy'?structuredClone(token!):token!
 const source=adverse==='changed source'?{...io.source,raw_payload:io.source.raw_payload!+' '}:io.source
 if(adverse==='expired')vi.setSystemTime(new Date(Date.now()+2001))
 expect(readReceivedZ04HStructuralFieldWitness(candidate,source,adverse==='wrong actor'?foreign:actor)).toBeNull();expect(io.writes).toEqual([])
})
it('copied decisions and repeat structural redemption grant no owner',async()=>{
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 expect(hasReceivedZ04HStructuralFieldRejection(decision,io.source,actor)).toBe(true)
 const copy=structuredClone(decision),token=await loadReceivedZ04HStructuralFieldRejection(io.source,actor)
 expect(response(copy)).toBeNull();expect(ownReceivedZ04HStructuralFieldRejection(copy,io.source,actor,token!)).toBe(false)
 const later=await loadReceivedZ04HStructuralFieldRejection(io.source,actor)
 expect(ownReceivedZ04HStructuralFieldRejection(decision,io.source,actor,later!)).toBe(false)
 decision.responsePlan.find(plan=>plan.family==='APERAK')!.outcome='positive'
 expect(hasReceivedZ04HStructuralFieldRejection(decision,io.source,actor)).toBe(false);expect(response(decision)).toBeNull()
})
it.each(['healthy','A reason','D reason','invalid LIN','invalid agency','missing required birth','foreign legal','foreign witness','foreign actor','source READ error','legal READ error','registry READ error','expired READ'] as const)('private structural H route refuses %s inputs',async adverse=>{
 if(adverse==='healthy')qualified(null)
 if(['A reason','D reason','invalid LIN','invalid agency'].includes(adverse)){
  const changed=io.source.raw_payload!.replace('CAV+Z25',adverse==='A reason'?'CAV+Z26':adverse==='D reason'?'CAV+Z70':'CAV+Z25')
   .replace('LIN+1++:::9',adverse==='invalid LIN'?'LIN+2++:::9':adverse==='invalid agency'?'LIN+1++:::XX':'LIN+1++:::9')
  io.source=withProdatFixtureInsertContext({...io.source,raw_payload:changed});io.rows.ediel_messages=[structuredClone(io.source) as unknown as Row]
 }
 if(adverse==='missing required birth')delete ((io.source.execution_context_snapshot as unknown as Row).receivedProdatContext as Row).version
 if(adverse==='foreign legal')io.legal!.environment='production'
 if(adverse==='foreign witness')io.registry[0].source_hash='b'.repeat(64)
 if(adverse==='foreign actor')io.permission=false
 if(adverse==='source READ error')io.sourceReadError=true
 if(adverse==='legal READ error')io.legalReadError=true
 if(adverse==='registry READ error')io.registryReadError=true
 if(adverse==='expired READ')io.readDelayMs=2001
 const token=await loadReceivedZ04HStructuralFieldRejection(io.source,actor).catch(error=>error)
 if(adverse==='foreign actor')expect(token).toMatchObject({disposition:{kind:'security_quarantine'}})
 else expect(token).toBeNull()
 expect(io.writes).toEqual([])
})
it.each([['actor','id'],['actor','company_id'],['original-read','id'],['original-read','company_id']] as const)('caller %s-stage %s mutation cannot redirect authorized original READ',async(stage,field)=>{
 const original=structuredClone(io.source),mutate=()=>{io.source[field]=foreign}
 if(stage==='actor')io.actorReadHook=mutate;else io.originalReadHook=mutate
 const token=await loadReceivedZ04HStructuralFieldRejection(io.source,actor)
 expect(io.calls.filter(call=>call.name==='gridex_actor_has_company_permission').map(call=>call.args)).toEqual([{p_actor_user_id:actor,p_company_id:original.company_id,p_permission:'communication.read'}])
 expect(io.sourceQueryFilters).toEqual([{key:'id',value:original.id},{key:'company_id',value:original.company_id}])
 expect(token).not.toBeNull();expect(readReceivedZ04HStructuralFieldWitness(token!,io.source,actor)).toBeNull()
 expect(readReceivedZ04HStructuralFieldWitness(token!,original,actor)).not.toBeNull();expect(io.writes).toEqual([])
})
it('unknown positive bilateral READ failure still permits only separately qualified physical negative owner',async()=>{
 io.bilateralError=new Error('DECLARED_UNAVAILABLE_POSITIVE_H_SOURCE')
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 expect(decision).toMatchObject({policy:null,applicationDecision:'rejected',functionalDecision:'not_applicable'})
 expect(response(decision)?.responses.every(row=>row.ercCode==='42')).toBe(true);expect(io.writes).toEqual([])
})
it('typed positive-source security denial propagates before the rejection-only actor/source reads',async()=>{
 io.bilateralError=new EdielExecutionFailure({kind:'security_quarantine',code:'EDIEL_H_CAPABILITY_SECURITY_DENIED'},'declared denial')
 const failure=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor}).catch(error=>error)
 expect(failure).toMatchObject({disposition:{kind:'security_quarantine'}})
 expect(io.calls.some(call=>call.name==='gridex_actor_has_company_permission')).toBe(false);expect(io.writes).toEqual([])
})
it('healthy H without positive agreement never borrows a missing-field negative route',async()=>{
 qualified(null);const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 expect(decision.applicationDecision).not.toBe('accepted');expect(response(decision)).toBeNull()
 expect(decision.responsePlan.filter(plan=>plan.family==='APERAK')).toEqual([]);expect(io.writes).toEqual([])
})
it.each(fields)('captured SQL response validator accepts actual H%s negative facet, preserving actual physical references',async field=>{
 qualified(field);const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 const evidence=buildReceivedSourceValidationEvidence({original:io.source,validated:io.source,resolvedCompanyId:company,decision})
 expect(evidence?.prodatResponseValidation).toBeDefined()
 const schema=readFileSync('supabase/schema.sql','utf8')
 const captured=(name:string)=>{
  const start=schema.indexOf('CREATE FUNCTION '+name+'(')
  if(start<0)throw Error('ACTUAL_CAPTURED_FUNCTION_REQUIRED:'+name)
  const rest=schema.slice(start),tag=/\bAS (\$[a-zA-Z0-9_]*\$)/.exec(rest)
  if(!tag)throw Error('ACTUAL_CAPTURED_FUNCTION_BODY_REQUIRED:'+name)
  const end=rest.indexOf(tag[1]+';',tag.index+tag[0].length)
  if(end<0)throw Error('ACTUAL_CAPTURED_FUNCTION_END_REQUIRED:'+name)
  return rest.slice(0,end+tag[1].length+1)
 }
 // Only genuine pure SQL lexer/validator bodies run here. No accepted source,
 // canonical ledger, current roles or native ACK prepare is declared or seeded.
 const db=new PGlite()
 try{
  await db.exec('CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_received_sources;')
  await db.exec(captured('gridex_utilts_binding.wire_tokens_v1'))
  await db.exec(captured('gridex_received_sources.validate_prodat_responses_v1'))
  const accepts=async(raw:string,facts:string,facet:unknown)=>(await db.query<{accepted:boolean}>(
   'SELECT gridex_received_sources.validate_prodat_responses_v1($1,$2::jsonb,$3::jsonb) AS accepted',[raw,facts,JSON.stringify(facet)])).rows[0].accepted
  expect(await accepts(io.source.raw_payload!,evidence!.factsText,evidence!.prodatResponseValidation)).toBe(true)
  const positive=structuredClone(evidence!.prodatResponseValidation!)
  positive.objects[0].outcome='positive';positive.responses[0].ercCode='100'
  expect(await accepts(io.source.raw_payload!,evidence!.factsText,positive)).toBe(false)
  expect(await accepts(io.source.raw_payload!+' ',evidence!.factsText,evidence!.prodatResponseValidation)).toBe(false)
  const facts=JSON.parse(evidence!.factsText);facts.registerValidation.owner='CALLER_REGISTER'
  expect(await accepts(io.source.raw_payload!,JSON.stringify(facts),evidence!.prodatResponseValidation)).toBe(false)
  expect(io.writes).toEqual([])
 }finally{await db.close()}
},30000)

const malformedEnvelopeChanges:readonly [string,(raw:string)=>string][]=[
 ['bad UNT count',raw=>raw.replace(/UNT\+\d+\+M/, 'UNT+999+M')],
 ['bad UNZ count',raw=>raw.replace('UNZ+1+I', 'UNZ+2+I')],
 ['changed UNH reference',raw=>raw.replace('UNH+M+', 'UNH+FOREIGN+')],
 ['changed UNZ control',raw=>raw.replace('UNZ+1+I', 'UNZ+1+FOREIGN')],
 ['invalid full source grammar',raw=>raw.replace('PRODAT:D:97A:UN:E2SE6A', 'PRODAT:D:UNKNOWN:UN:E2SE6A')],
]
it.each(malformedEnvelopeChanges)('actual persisted %s cannot borrow an accepted cached status or forged syntax decision',async(_name,change)=>{
 const changed=change(io.source.raw_payload!);expect(changed).not.toBe(io.source.raw_payload)
 const source=withProdatFixtureInsertContext({...io.source,raw_payload:changed,status:'validated',syntax_check_status:'passed',validation_report:{syntax:{ok:true}},failure_reason:null})
 io.source=source;io.rows.ediel_messages=[structuredClone(source) as unknown as Row]
 expect(validateEdifactSyntax({...source,status:'received',syntax_check_status:'not_checked',validation_report:{},failure_reason:null}).ok).toBe(false)
 expect(await loadReceivedZ04HStructuralFieldRejection(source,actor)).toBeNull()
 expect(io.calls.some(call=>call.name==='ediel_require_inbound_legal_context_v1')).toBe(false);expect(io.writes).toEqual([])
})
const receiptDates=[['2026-09-21T21:59:59.999999Z','2026-09-21'],['2026-09-21T22:00:00Z','2026-09-22'],['2026-09-22T00:00:00Z','2026-09-22']] as const
it.each(receiptDates)('birth selector compares original witness at actual Stockholm receipt date %s → %s',async(receivedAt,date)=>{
 io.source={...io.source,message_received_at:receivedAt,created_at:receivedAt,execution_context_snapshot:{receivedProdatContext:{
  version:1,contextOrigin:'database_insert',sourceMessageId:io.source.id,companyId:company,environment:'test',messageCode:'Z04',
  payloadHash:evidenceHash(io.source.raw_payload!),sourceReceivedAt:receivedAt,capturedAt:receivedAt}}}
 io.rows.ediel_messages=[structuredClone(io.source) as unknown as Row]
 io.legal!.sourceReceivedAt=receivedAt;io.legal!.observedAt=receivedAt
 io.registry[0].valid_from=date
 const token=await loadReceivedZ04HStructuralFieldRejection(io.source,actor);expect(token).not.toBeNull()
 expect(io.calls.filter(call=>call.name==='resolve_canonical_ediel_rule_pack_with_witness_v1').map(call=>call.args.p_business_date)).toEqual([date])
 expect(readReceivedZ04HStructuralFieldWitness(token!,io.source,actor)).not.toBeNull();expect(io.writes).toEqual([])
})

import {renderAperakEdiel} from '@/lib/ediel/aperakEngine'
it.each(fields)('actual renderer preserves H%s typed failure and its physical response scope',async field=>{
 qualified(field);const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 const plans=decision.responsePlan.filter(plan=>plan.family==='APERAK')
 expect(plans).toHaveLength(1)
 const rendered=renderAperakEdiel({source:{id:io.source.id,messageFamily:'PRODAT',messageCode:'Z04',rawPayload:io.source.raw_payload,
  messageReceivedAt:io.source.message_received_at},refs:{},externalReference:'OWNER',transactionReference:'OWNER',
  outcome:'negative',applicationErrors:plans[0].applicationErrors,prodatProspectiveObjectProjection:true})
 const wire=tokenizeEdifact(rendered.segments.map(segment=>segment+"'").join(''))
 const erc=wire.segments.filter(segment=>segment.tag==='ERC'),ftx=wire.segments.filter(segment=>segment.tag==='FTX')
 expect(erc).toHaveLength(1);expect(ftx).toHaveLength(1)
 expect(segmentComposite(erc[0],1,wire.una)).toEqual([field==='314'?'41':'42','','260'])
 expect(segmentComposite(ftx[0],3,wire.una)).toEqual([field,'','260'])
 expect(segmentComposite(ftx[0],4,wire.una)).toEqual([field==='314'?'Sekvensnummer saknas':'Felaktigt Anläggnings-id :::9'])
 expect(segmentComposite(wire.segments.find(segment=>segment.tag==='BGM'),3,wire.una)).toEqual([field==='314'?'27':'34'])
 const refs=(qualifier:string)=>wire.segments.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,wire.una)[0]===qualifier)
 expect(refs('LI')).toHaveLength(1);expect(segmentComposite(refs('LI')[0],1,wire.una)).toEqual(['LI','CASE-1'])
 if(field==='209')expect(refs('Z07')).toEqual([])
 else{expect(refs('Z07')).toHaveLength(1);expect(segmentComposite(refs('Z07')[0],1,wire.una)).toEqual(['Z07','735123456789012345'])}
 expect(io.writes).toEqual([])
})
