// Finite H258 rejection-only regression. Real canonical syntax, physical
// register validators, fresh actor/source/legal/catalog decoders and public
// receiver execute. Database transport is declared and the canonical writer
// refuses persistence: no ledger, private prepare receipt or business authority is seeded.
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {ownerId,ownerRows,ownerSource,ownerRulePack} from './helpers/sourceOwnerFixtures'
import {withProdatFixtureInsertContext} from './helpers/prodatInboundSourceFixture'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {resolveCanonicalRuntimeDecisionWithRegistry,readReceivedCanonicalProdatResponseValidation,
 readReceivedCanonicalProdatApplicationObjects,readReceivedCanonicalProdatSourceFunction} from '@/lib/ediel/core/runtimeDecision'
import {prodatAckObjectScopes} from '@/lib/ediel/prodat/prodatAckMessageFunction'
import {prepareSourceAckDraft} from '@/lib/ediel/ack/prepareSourceAckDraft'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {loadReceivedZ04HRegisterRejection,ownReceivedZ04HRegisterRejection,readReceivedZ04HRegisterWitness,
 hasReceivedZ04HRegisterRejection,observeReceivedZ04HRegister} from '@/lib/ediel/prodat/receivedZ04HRegisterRejection'


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

function message(valid=false):EdielMessageRow {
 const original=ownerSource(),wire=tokenizeEdifact(original.raw_payload!)
 const parts=wire.segments.map(segment=>segment.tag==='CAV'&&segmentComposite(segment,1,wire.una)[0]==='Z22'
  ?segment.raw.replace('Z22','Z25'):segment.tag==='LIN'?segment.raw+'+1:1':segment.raw)
 const end=parts.findIndex(part=>part.startsWith('UNT+'))
 parts.splice(end,0,`LIN+2++735123456789012345:::9+1:${valid?'2':''}`,'QTY+31:20:KWH')
 const first=parts.findIndex(part=>part.startsWith('UNH+')),last=parts.findIndex(part=>part.startsWith('UNT+'))
 parts[last]=`UNT+${last-first+1}+M`
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
function qualified(){
 const registry=ownerRulePack(),profileKey='PRODAT:Z04:H:26.A:r3'
 const profile={...registry.profile,transactionSubtype:'H',reasonForTransaction:'Z25'}
 const rulePack=structuredClone(registry.original_snapshot.rulePack)
 const messageProfile={...registry.original_snapshot.messageProfile,profile_key:profileKey,profile}
 const snapshot={rulePack,messageProfile,guideSources:[]}
 const row=message(),tokens=tokenizeEdifact(row.raw_payload!).segments.map(segment=>segment.raw)
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
const errors258=(decision:Awaited<ReturnType<typeof resolveCanonicalRuntimeDecisionWithRegistry>>)=>
 decision.responsePlan.filter(plan=>plan.family==='APERAK'&&plan.outcome==='negative').flatMap(plan=>plan.applicationErrors??[]).filter(error=>error.fieldCode==='258')
it('actorless H observation keeps the actual malformed second-register258 and prospective negative plan without a response capability',async()=>{
 expect(validateEdifactSyntax(io.source).ok).toBe(true)
 const before=structuredClone(io.source),decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source)
 expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'258'})})]))
 expect(decision.applicationDecision).not.toBe('accepted');expect(decision.policy).toBeNull()
 expect(errors258(decision).length).toBeGreaterThan(0)
 expect(errors258(decision).every(error=>error.prodatFieldDiagnostic?.kind==='field'&&error.prodatFieldDiagnostic.occurrence.lineIndex===1)).toBe(true)
 expect(readReceivedCanonicalProdatResponseValidation(decision,io.source)).toBeNull()
 expect(readReceivedCanonicalProdatApplicationObjects(decision,io.source)).toBeNull()
 expect(readReceivedCanonicalProdatSourceFunction(decision,io.source)).toBeNull()
 expect(buildReceivedSourceValidationEvidence({original:io.source,validated:io.source,resolvedCompanyId:company,decision})?.prodatResponseValidation).toBeUndefined()
 expect(io.calls.some(call=>call.name==='gridex_actor_has_company_permission')).toBe(false)
 expect(io.writes).toEqual([]);expect(io.source).toEqual(before)
})
it('genuine actor-qualified H rejection yields only rejected register and negative response facets',async()=>{
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 expect(errors258(decision).length).toBeGreaterThan(0)
 expect(decision).toMatchObject({policy:null,syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'not_applicable'})
 expect(decision.prodatRegisterValidation?.objects).toEqual(expect.arrayContaining([expect.objectContaining({disposition:'rejected'})]))
 const facet=readReceivedCanonicalProdatResponseValidation(decision,io.source)
 expect(facet?.responses).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:'258',ercCode:'42'})]))
 expect(facet?.responses.some(response=>response.ercCode==='100')).toBe(false)
 const evidence=buildReceivedSourceValidationEvidence({original:io.source,validated:io.source,resolvedCompanyId:company,decision})
 expect(evidence?.prodatResponseValidation).toEqual(facet)
 expect(evidence?.prodatObjectValidation).toBeUndefined();expect(evidence?.prodatApplicationValidation).toBeUndefined()
 expect(evidence?.prodatSourceFunctionValidation).toBeUndefined()
})
it('public actor-qualified receiver attempts the real rejected canonical writer and halts on refusal without business/status/ACK writes',async()=>{
 const before=structuredClone({source:io.source,graphs:io.rows})
 const error=await processInboundEdielMessage({actorUserId:actor,edielMessageId:io.source.id}).catch(error=>error)
 expect(error?.message).toBe('prodat_canonical_source_validation_unconfirmed')
 const writes=io.writes.filter(write=>write.port==='gridex_record_prodat_source_validation_v6')
 expect(writes).toHaveLength(1)
 const value=writes[0].value
 expect(JSON.parse(String(value.p_facts_text))).toMatchObject({applicationDecision:'rejected',functionalDecision:'not_applicable'})
 expect(JSON.parse(String(value.p_response_facts_text)).responses).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:'258'})]))
 expect(value.p_object_facts_text).toBeNull();expect(value.p_application_facts_text).toBeNull();expect(value.p_source_function_facts_text).toBeNull()
 expect(io.status).toBeNull();expect({source:io.source,graphs:io.rows}).toEqual(before)
})
it('healthy second register never borrows the rejection-only H route when positive bilateral grounds are absent',async()=>{
 const healthy=message(true),raw=tokenizeEdifact(healthy.raw_payload!).segments.map(segment=>segment.raw)
 const unb=raw.findIndex(segment=>segment.startsWith('UNB+'));raw[unb]+='++1++1'
 setSource(withProdatFixtureInsertContext({...healthy,raw_payload:"UNA:+.? '"+raw.join("'")+"'"}))
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 expect(errors258(decision)).toEqual([]);expect(decision.applicationDecision).not.toBe('accepted')
 expect(decision.responsePlan.filter(plan=>plan.family==='APERAK'&&plan.outcome==='negative')).toEqual([])
 expect(readReceivedCanonicalProdatResponseValidation(decision,io.source)).toBeNull()
})

it.each(['copy','wrong actor','expired','changed source'] as const)('the fresh H258 READ token refuses %s redemption',async adverse=>{
 const token=await loadReceivedZ04HRegisterRejection(io.source,actor)
 expect(token).not.toBeNull();expect(readReceivedZ04HRegisterWitness(token!,io.source,actor)).not.toBeNull()
 const candidate=adverse==='copy'?structuredClone(token!):token!
 const source=adverse==='changed source'?{...io.source,raw_payload:io.source.raw_payload!+' '}:io.source
 if(adverse==='expired')vi.setSystemTime(new Date(Date.now()+2001))
 expect(readReceivedZ04HRegisterWitness(candidate,source,adverse==='wrong actor'?foreign:actor)).toBeNull()
 expect(io.writes).toEqual([])
})
it('copied or changed decisions and consumed structural proofs cannot acquire an H258 owner',async()=>{
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 expect(hasReceivedZ04HRegisterRejection(decision,io.source,actor)).toBe(true)
 expect(hasReceivedZ04HRegisterRejection(decision,io.source,foreign)).toBe(false)
 const copy=structuredClone(decision)
 expect(readReceivedCanonicalProdatResponseValidation(copy,io.source)).toBeNull()
 const token=await loadReceivedZ04HRegisterRejection(io.source,actor)
 expect(ownReceivedZ04HRegisterRejection(copy,io.source,actor,token!)).toBe(false)
 expect(readReceivedZ04HRegisterWitness(token!,io.source,actor)).toBeNull()
 const later=await loadReceivedZ04HRegisterRejection(io.source,actor)
 expect(ownReceivedZ04HRegisterRejection(decision,io.source,actor,later!)).toBe(false)
 decision.responsePlan[decision.responsePlan.length-1].outcome='positive'
 expect(hasReceivedZ04HRegisterRejection(decision,io.source,actor)).toBe(false)
 expect(readReceivedCanonicalProdatResponseValidation(decision,io.source)).toBeNull()
 expect(io.writes).toEqual([])
})
it.each([
 ['actor','id'],['actor','company_id'],['original-read','id'],['original-read','company_id'],
] as const)('caller %s-stage %s mutation cannot redirect the authorized H258 original READ',async(stage,field)=>{
 const original=structuredClone(io.source),mutate=()=>{io.source[field]=foreign}
 if(stage==='actor')io.actorReadHook=mutate;else io.originalReadHook=mutate
 const token=await loadReceivedZ04HRegisterRejection(io.source,actor)
 expect(io.calls.filter(call=>call.name==='gridex_actor_has_company_permission').map(call=>call.args))
  .toEqual([{p_actor_user_id:actor,p_company_id:original.company_id,p_permission:'communication.read'}])
 expect(io.sourceQueryFilters).toEqual([{key:'id',value:original.id},{key:'company_id',value:original.company_id}])
 expect(token).not.toBeNull();expect(readReceivedZ04HRegisterWitness(token!,io.source,actor)).toBeNull()
 expect(readReceivedZ04HRegisterWitness(token!,original,actor)).not.toBeNull();expect(io.writes).toEqual([])
})
const wireChanges:readonly [string,(raw:string)=>string][]=[
 ['valid second',raw=>raw.replace('LIN+2++735123456789012345:::9+1:', 'LIN+2++735123456789012345:::9+1:2')],
 ['wrong first',raw=>raw.replace('LIN+1++735123456789012345:::9+1:1','LIN+1++735123456789012345:::9+1:2')],
 ['foreign second point',raw=>raw.replace('LIN+2++735123456789012345:::9','LIN+2++FOREIGN:::9')],
 ['foreign second agency',raw=>raw.replace('LIN+2++735123456789012345:::9','LIN+2++735123456789012345:::89')],
 ['wrong reason',raw=>raw.replace('CAV+Z25', 'CAV+Z26')],
 ['extra reason',raw=>raw.replace('QTY+31:20:KWH', "QTY+31:20:KWH'CCI++Z13'CAV+Z25")],
 ['wrong code',raw=>raw.replace('BGM+Z04','BGM+Z05')],
]
it.each(wireChanges)('physical %s cannot borrow the exact second258 rejection',(_name,change)=>{
 const wire=tokenizeEdifact(change(io.source.raw_payload!))
 expect(observeReceivedZ04HRegister({rawSegments:wire.segments.map(row=>row.raw),una:wire.una})).toEqual([])
 expect(io.writes).toEqual([])
})
it('the actual captured SQL response validator accepts only the real negative facet, without a ledger or prepare receipt',async()=>{
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
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
const adverseReads:readonly [string,()=>void][]=[
 ['missing protected original',()=>{io.rows.ediel_messages=[]}],
 ['different protected raw/hash',()=>{io.rows.ediel_messages[0].raw_payload=String(io.rows.ediel_messages[0].raw_payload)+' '}],
 ['foreign protected company',()=>{io.rows.ediel_messages[0].company_id=foreign}],
 ['wrong protected environment',()=>{io.rows.ediel_messages[0].environment='production'}],
 ['wrong born H profile',()=>{io.rows.ediel_messages[0].rule_profile_key='PRODAT:Z04:D:26.A:r3'}],
 ['wrong born guide checksum',()=>{io.rows.ediel_messages[0].rule_pack_checksum='f'.repeat(64)}],
 ['missing protected legal receipt',()=>{io.legal=null}],
 ['foreign legal company',()=>{io.legal!.companyId=foreign}],
 ['wrong legal environment',()=>{io.legal!.environment='production'}],
 ['wrong born legal receiver',()=>{io.legal!.legalEdielId='99999'}],
 ['different protected receipt clock',()=>{io.legal!.sourceReceivedAt='2026-09-22T10:00:00.000001Z'}],
 ['missing born edition',()=>{delete io.legal!.sourceEdition}],
 ['malformed born edition',()=>{io.legal!.sourceEdition='CALLER-UNKNOWN'}],
 ['wrong born physical projection',()=>{(io.legal!.canonicalProjection as Row).transactionReasonCode='Z70'}],
 ['missing named catalogue row',()=>{io.registry=[]}],
 ['ambiguous named catalogue rows',()=>{io.registry.push(structuredClone(io.registry[0]))}],
 ['different named profile snapshot',()=>{const snapshot=io.registry[0].original_snapshot as Row;(snapshot.messageProfile as Row).profile_key='FOREIGN'}],
 ['mismatched named rule-pack hash',()=>{io.registry[0].source_hash='f'.repeat(64)}],
 ['expired named catalogue window',()=>{io.registry[0].valid_to='2025-01-01'}],
 ['protected source READ refusal',()=>{io.sourceReadError=true}],
 ['protected legal READ refusal',()=>{io.legalReadError=true}],
 ['named catalogue READ refusal',()=>{io.registryReadError=true}],
 ['elapsed protected READ deadline',()=>{io.readDelayMs=2501}],
 ['missing execution membership',()=>{io.rows.company_memberships=[]}],
 ['revoked execution permission',()=>{io.permission=false}],
]
it.each(adverseReads)('unqualified %s cannot own a rejection response or positive/full facet',async(_name,change)=>{
 change();const before=structuredClone({source:io.source,graphs:io.rows})
 // Current execution denials retain their actual security taxonomy, stronger
 // than a missing/unknown authority hold. Collect once only to observe writes.
 let failure:unknown
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor}).catch(error=>{failure=error;return null})
 if(_name==='missing execution membership'||_name==='revoked execution permission'){
  if(decision){
   expect(readReceivedCanonicalProdatResponseValidation(decision,io.source)).toBeNull()
   expect(readReceivedCanonicalProdatApplicationObjects(decision,io.source)).toBeNull()
   expect(readReceivedCanonicalProdatSourceFunction(decision,io.source)).toBeNull()
   expect(decision.applicationDecision).not.toBe('accepted');expect(decision.functionalDecision).not.toBe('accepted')
  }
  expect(io.writes).toEqual([]);expect({source:io.source,graphs:io.rows}).toEqual(before)
  expect(failure).toBeInstanceOf(EdielExecutionFailure)
  expect(failure).toMatchObject({disposition:{kind:'security_quarantine',code:_name==='missing execution membership'?'EDIEL_TENANT_ACTOR_FORBIDDEN':'EDIEL_TENANT_PERMISSION_FORBIDDEN'},
   message:_name==='missing execution membership'?'ediel_tenant_actor_forbidden':'ediel_tenant_permission_forbidden'})
  expect(decision).toBeNull();return
 }
 // A prior early policy hold cannot credit the new reader's protection.
 const legalReadRequired=['missing protected legal receipt','foreign legal company','wrong legal environment','wrong born legal receiver',
  'different protected receipt clock','missing born edition','malformed born edition','wrong born physical projection',
  'protected legal READ refusal','elapsed protected READ deadline']
 const registryReadRequired=['missing named catalogue row','ambiguous named catalogue rows','different named profile snapshot',
  'mismatched named rule-pack hash','expired named catalogue window','named catalogue READ refusal']
 if(legalReadRequired.includes(_name)||registryReadRequired.includes(_name))expect.soft(io.calls.some(call=>call.name==='ediel_require_inbound_legal_context_v1')).toBe(true)
 if(registryReadRequired.includes(_name))expect.soft(io.calls.some(call=>call.name==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toBe(true)
 expect(failure).toBeUndefined();expect(decision).not.toBeNull()
 if(!decision)throw Error('EXPECTED_ACTUAL_HELD_DECISION')
 expect(decision.policy).toBeNull();expect(decision.applicationDecision).not.toBe('accepted')
 expect(decision.functionalDecision).not.toBe('accepted')
 expect(readReceivedCanonicalProdatResponseValidation(decision,io.source)).toBeNull()
 expect(readReceivedCanonicalProdatApplicationObjects(decision,io.source)).toBeNull()
 expect(readReceivedCanonicalProdatSourceFunction(decision,io.source)).toBeNull()
 expect(io.writes).toEqual([]);expect({source:io.source,graphs:io.rows}).toEqual(before)
})
it('malformed international grammar reaches no rejection authority reads',async()=>{
 const malformed={...io.source,raw_payload:io.source.raw_payload!.replace('UNH+M+PRODAT:D:97A:UN:E2SE6A','UNH+M+PRODAT:D:00A:UN:E2SE6A')}
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(malformed,{actorUserId:actor})
 expect(decision.syntaxDecision).not.toBe('accepted');expect(readReceivedCanonicalProdatResponseValidation(decision,malformed)).toBeNull()
 expect(io.calls).toEqual([]);expect(io.writes).toEqual([])
})

it.each(wireChanges.filter(([name])=>!['wrong code','wrong reason'].includes(name)))('non-target %s H runtime creates no prospective negative258 plan',async(_name,change)=>{
 const source=withProdatFixtureInsertContext({...io.source,raw_payload:change(io.source.raw_payload!)})
 setSource(source)
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source)
 expect(decision.responsePlan.filter(plan=>plan.family==='APERAK'&&plan.outcome==='negative')).toEqual([])
 expect(readReceivedCanonicalProdatResponseValidation(decision,io.source)).toBeNull()
 expect(io.writes).toEqual([])
})

it('actual operational mapper selects the genuine first ACK object for its source-qualified second258 without inheriting register authority',async()=>{
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor}),wire=tokenizeEdifact(io.source.raw_payload!)
 const errors=errors258(decision),first=wire.segments.find(row=>row.tag==='LIN')!
 expect(errors.length).toBeGreaterThan(0)
 expect(errors.every(error=>error.prodatFieldDiagnostic?.kind==='field'&&error.prodatFieldDiagnostic.occurrence.registerPosition===2)).toBe(true)
 expect(prodatAckObjectScopes({sourceWire:wire,messageCode:'Z04',outcome:'negative',applicationErrors:errors})).toEqual([
  {objectId:'735123456789012345',identityAgency:'9',firstLineIndex:first.index,lineItemReference:'CASE-1'},
 ])
 expect(io.writes).toEqual([])
})
it('actual ACK preparation reads protected existing scopes then renders the exact negative258 draft without a write or invented receipt',async()=>{
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 const prepared=await prepareSourceAckDraft({actorUserId:actor,sourceMessage:io.source,ackFamily:'APERAK',outcome:'negative',applicationErrors:errors258(decision)})
 expect(prepared.kind).toBe('draft')
 if(prepared.kind!=='draft')throw Error('EXPECTED_FRESH_FINITE_DRAFT')
 expect(prepared.draft).toMatchObject({direction:'outbound',messageFamily:'APERAK',environment:'test'})
 const wire=tokenizeEdifact(prepared.draft.rawPayload!),bgm=wire.segments.find(row=>row.tag==='BGM')!
 expect(segmentComposite(bgm,3,wire.una)[0]).toBe('34')
 expect(wire.segments.some(row=>row.tag==='ERC'&&segmentComposite(row,1,wire.una)[0]==='42')).toBe(true)
 expect(wire.segments.some(row=>row.tag==='FTX'&&segmentComposite(row,3,wire.una)[0]==='258')).toBe(true)
 expect(io.calls.filter(call=>call.name==='gridex_read_outbound_acks_for_source_v2').length).toBeGreaterThan(0)
 expect(io.writes).toEqual([])
})

it.each(wireChanges.filter(([name])=>name!=='valid second'))('actual negative mapper refuses borrowed H258 scope on %s source',async(_name,change)=>{
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 const sourceWire=tokenizeEdifact(change(io.source.raw_payload!))
 expect(()=>prodatAckObjectScopes({sourceWire,messageCode:'Z04',outcome:'negative',applicationErrors:errors258(decision)}))
  .toThrow('aperak_prodat_requested_scope_unqualified')
 expect(io.writes).toEqual([])
})
it.each(['erc','field','text','national-text','physical-coordinate'] as const)('actual negative mapper refuses %s substitution on genuine H258 source',async(change)=>{
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 const applicationErrors=structuredClone(errors258(decision)),error=applicationErrors[0]
 if(change==='erc')error.ercCode='100'
 if(change==='field')error.fieldCode='209'
 if(change==='text')error.text+=' forged'
 if(change==='national-text')error.prodatAperakText=undefined
 if(change==='physical-coordinate')error.prodatOccurrence!.registerPosition=1
 expect(()=>prodatAckObjectScopes({sourceWire:tokenizeEdifact(io.source.raw_payload!),messageCode:'Z04',outcome:'negative',applicationErrors}))
  .toThrow('aperak_prodat_requested_scope_unqualified')
 expect(io.writes).toEqual([])
})
it('actual positive selected scope retains invalid register chain refusal',()=>{
 const sourceWire=tokenizeEdifact(io.source.raw_payload!),first=sourceWire.segments.find(row=>row.tag==='LIN')!
 expect(()=>prodatAckObjectScopes({sourceWire,messageCode:'Z04',outcome:'positive',prodatAcknowledgementLineIndices:[first.index]}))
  .toThrow('aperak_prodat_selected_scope_invalid')
 expect(io.writes).toEqual([])
})

it.each([undefined,[]])('actual negative H258 mapper refuses empty application errors %s',applicationErrors=>{
 expect(()=>prodatAckObjectScopes({sourceWire:tokenizeEdifact(io.source.raw_payload!),messageCode:'Z04',outcome:'negative',applicationErrors}))
  .toThrow('aperak_prodat_requested_scope_unqualified')
 expect(io.writes).toEqual([])
})
it('actual negative mapper refuses unrelated physical raw substitution with preserved coarse coordinates',async()=>{
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,{actorUserId:actor})
 const sourceWire=tokenizeEdifact(io.source.raw_payload!.replace('LIN+2++735123456789012345:::9+1:', 'LIN+2++735123456789012345:::9+2:'))
 expect(()=>prodatAckObjectScopes({sourceWire,messageCode:'Z04',outcome:'negative',applicationErrors:errors258(decision)}))
  .toThrow('aperak_prodat_requested_scope_unqualified')
 expect(io.writes).toEqual([])
})
