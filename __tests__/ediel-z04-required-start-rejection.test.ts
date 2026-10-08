// Cooperative producer regression, not acceptance of the foreign A/D contracts.
// Actual syntax, canonical runtime, actor/tenant resolution and public receiver
// execute. Database transport is explicitly finite. The canonical writer refuses
// persistence and the status port stops execution: no accepted ledger, business
// capability, native prepare receipt, ACK or real database authority is fabricated.
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
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {requireEdielInboundLegalContext} from '@/lib/ediel/tenant/sourceLegalContext'
import {resolveCanonicalRulePack} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {loadReceivedZ04RequiredStartRejection,ownReceivedZ04RequiredStartRejection,readReceivedZ04RequiredStartWitness,
 hasReceivedZ04RequiredStartRejection} from '@/lib/ediel/prodat/receivedZ04RequiredStartRejection'

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

function message(subtype:'A'|'D',missing=true):EdielMessageRow{
 const original=ownerSource(),wire=tokenizeEdifact(original.raw_payload!)
 const parts=wire.segments.filter(s=>!(missing&&s.tag==='DTM'&&segmentComposite(s,1,wire.una)[0]==='92')).map(s=>
  s.tag==='CAV'&&segmentComposite(s,1,wire.una)[0]==='Z22'?s.raw.replace('Z22',subtype==='A'?'Z26':'Z70'):s.raw)
 const start=parts.findIndex(s=>s.startsWith('UNH+')),end=parts.findIndex(s=>s.startsWith('UNT+'))
 parts[end]=`UNT+${end-start+1}+M`
 const raw='UNA:+.? '+"'"+parts.join("'")+"'"
 return withProdatFixtureInsertContext({...original,raw_payload:raw,message_version:'E2SE6A',message_created_at:'2026-09-17T12:00:00Z',
  parsed_payload:{},customer_id:null,site_id:null,metering_point_id:null})
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
 const registry=ownerRulePack(),profileKey='PRODAT:Z04:A:26.A:r3'
 const profile={...registry.profile,transactionSubtype:'A',reasonForTransaction:'Z26'}
 const rulePack=structuredClone(registry.original_snapshot.rulePack)
 const messageProfile={...registry.original_snapshot.messageProfile,profile_key:profileKey,profile}
 const snapshot={rulePack,messageProfile,guideSources:[]}
 const row=message('A'),tokens=tokenizeEdifact(row.raw_payload!).segments.map(segment=>segment.raw)
 const unb=tokens.findIndex(segment=>segment.startsWith('UNB+'))
 tokens[unb]+='++1++1' // Declared test source agrees with its physical UNB.
 const raw="UNA:+.? '"+tokens.join("'")+"'"
 setSource(withProdatFixtureInsertContext({...row,raw_payload:raw,canonical_rule_pack_id:registry.rule_pack_id,
  rule_profile_key:profileKey,rule_profile_version_id:registry.message_profile_id,rule_profile_version:registry.original_version,
  rule_pack_checksum:registry.source_hash,rule_pack_snapshot:{...snapshot,profileKey,profileVersionId:registry.message_profile_id,
   version:registry.original_version,checksum:registry.source_hash}}))
 io.registry=[{...registry,profile_key:profileKey,profile,original_snapshot:structuredClone(snapshot)}]
 io.legal={basisKind:'observed_source_persistence',companyId:company,environment:'test',direction:'inbound',family:'PRODAT',
  code:'Z04',subtype:'A',legalActorId:ownerId(9),legalEdielId:'54321',actorRole:'electricity_supplier',
  // This opaque legal catalogue edition is distinct from the born pack checksum.
  transportActorId:ownerId(9),transportEdielId:'54321',applicationReference:'23-DDQ-PRODAT',sourceEdition:'c'.repeat(64),
  canonicalProjection:{family:'PRODAT',code:'Z04',subtype:'A',transactionReasonCode:'Z26',direction:'inbound',
   senderRoles:['grid_owner'],receiverRoles:['supplier'],applicationReferences:['23-DDQ-PRODAT']},
  observedAt:io.source.message_received_at,sourceReceivedAt:io.source.message_received_at,facts:{profile:io.rows.tenant_ediel_profiles[0],
   identifiers:io.rows.tenant_actor_identifiers,roles:io.rows.tenant_actor_roles,transportRelation:null,transportIdentifiers:null}}
}
// A variable with existing time-anchor shape carries the prospective typed
// actor input without changing the original public API to write the old RED.
const actorFacts=()=>({admissionAt:io.source.message_received_at!,actorUserId:actor})
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-30T13:00:00Z'));setSource(message('A'))})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
const own210=(issues:unknown)=>Array.isArray(issues)&&issues.some(item=>item.prodatDiagnostic?.kind==='field'&&
 item.prodatDiagnostic.fieldNumber==='210'&&item.prodatDiagnostic.errorKind==='missing'&&
 item.prodatDiagnostic.occurrence.objectId==='735123456789012345'&&item.prodatDiagnostic.occurrence.lineItemReference==='CASE-1')

it.each([
 ['actor','id'],['actor','company_id'],['original-read','id'],['original-read','company_id'],
] as const)('caller %s-stage %s mutation cannot redirect the authorized R210 original READ',async(stage,field)=>{
 qualified()
 const original=structuredClone(io.source),graphs=structuredClone(io.rows)
 const mutate=()=>{
  io.source[field]=foreign
  if(stage==='actor'){
   const context=(io.source.execution_context_snapshot as unknown as Row).receivedProdatContext as Row
   context[field==='id'?'sourceMessageId':'companyId']=foreign
  }
 }
 if(stage==='actor')io.actorReadHook=mutate;else io.originalReadHook=mutate
 const token=await loadReceivedZ04RequiredStartRejection(io.source,actor)
 expect(io.source[field]).toBe(foreign)
 expect(io.calls.filter(c=>c.name==='gridex_actor_has_company_permission').map(c=>c.args))
  .toEqual([{p_actor_user_id:actor,p_company_id:original.company_id,p_permission:'communication.read'}])
 expect(io.sourceQueryFilters).toEqual([{key:'id',value:original.id},{key:'company_id',value:original.company_id}])
 expect(io.calls.filter(c=>c.name==='ediel_require_inbound_legal_context_v1').map(c=>c.args))
  .toEqual([{p_company_id:original.company_id,p_message_id:original.id}])
 if(token){
  expect(readReceivedZ04RequiredStartWitness(token,io.source,actor)).toBeNull()
  expect(readReceivedZ04RequiredStartWitness(token,original,actor)).not.toBeNull()
 }
 expect(io.rows).toEqual(graphs);expect(io.writes).toEqual([])
})

it.each(['unavailable','unserializable'] as const)('actor quarantine precedes %s born identity refusal',async adverse=>{
 qualified();io.permission=false
 if(adverse==='unavailable'){
  delete ((io.source.execution_context_snapshot as unknown as Row).receivedProdatContext as Row).version
 }else{
  const snapshot=io.source.rule_pack_snapshot as unknown as Row
  snapshot.self=snapshot
 }
 const failure=await loadReceivedZ04RequiredStartRejection(io.source,actor).catch(error=>error)
 expect(failure).toBeInstanceOf(EdielExecutionFailure)
 expect(failure).toMatchObject({disposition:{kind:'security_quarantine',code:'EDIEL_TENANT_PERMISSION_FORBIDDEN'}})
 expect(io.calls.filter(c=>c.name==='gridex_actor_has_company_permission')).toHaveLength(1)
 expect(io.sourceQueryFilters).toEqual([])
 expect(io.calls.filter(c=>c.name==='ediel_require_inbound_legal_context_v1')).toEqual([])
 expect(io.writes).toEqual([])
})

it.each(['A','D'] as const)('actual actorless %s observation reports physical R210 without minting business authority',async subtype=>{
 setSource(message(subtype));expect(validateEdifactSyntax(io.source).ok).toBe(true)
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source)
 console.info('Actual missing210 observation',JSON.stringify({subtype,syntax:decision.syntaxDecision,application:decision.applicationDecision,
  functional:decision.functionalDecision,issues:decision.issues.map(i=>({code:i.code,diagnostic:i.prodatDiagnostic})),reads:io.calls.map(c=>c.name)}))
 expect.soft(decision.syntaxDecision).toBe('accepted')
 if(subtype==='A'){expect.soft(decision.policy).toBeNull();expect.soft(decision.prodatApplicationValidation).toBeUndefined()}
 else expect.soft(decision.policy?.subtype).toBe('D') // D has no bilateral-only policy requirement.
 expect.soft(decision.applicationDecision).not.toBe('accepted')
 expect.soft(decision.prodatSourceFunctionValidation).toBeUndefined()
 expect(own210(decision.issues)).toBe(true)
})
it('public A receiver reaches genuine missing210 decision before the refused canonical writer',async()=>{
 const subtype='A'
 qualified();expect(validateEdifactSyntax(io.source).ok).toBe(true)
 const before=structuredClone({source:io.source,graphs:io.rows})
 const error=await processInboundEdielMessage({actorUserId:actor,edielMessageId:io.source.id}).catch(e=>e)
 console.info('Actual public missing210 boundary',JSON.stringify({subtype,error:error?.message,ports:io.writes.map(w=>w.port),
  reads:io.calls.map(c=>c.name),statusBoundaryReached:io.status!==null}))
 expect({source:io.source,graphs:io.rows}).toEqual(before)
 const canonical=io.writes.filter(w=>w.port==='gridex_record_prodat_source_validation_v6')
 expect(canonical).toHaveLength(1)
 const facts=JSON.parse(String(canonical[0].value.p_facts_text))
 expect(facts.applicationDecision).not.toBe('accepted');expect(facts.functionalDecision).not.toBe('accepted')
 expect(canonical[0].value.p_object_facts_text).toBeNull();expect(canonical[0].value.p_application_facts_text).toBeNull()
 expect(canonical[0].value.p_source_function_facts_text).toBeNull()
 // The caller must halt when the canonical database owner refuses the real
 // attempt. This expectation does not supply a forged successful receipt.
 expect.soft(error?.message).toBe('prodat_canonical_source_validation_unconfirmed')
 const response=canonical[0].value.p_response_facts_text
 expect(typeof response).toBe('string')
 expect(JSON.parse(String(response)).responses).toEqual(expect.arrayContaining([
  expect.objectContaining({ercCode:'41',fieldCode:'210',id:'735123456789012345',li:'CASE-1'}),
 ]))
})
it.each(['membership','permission'] as const)('public missing A210 stops %s denial before tenant/diagnostic/canonical writers even with a NULL endpoint',async denial=>{
 qualified();if(denial==='membership')io.rows.company_memberships=[];else io.permission=false
 const before=structuredClone({source:io.source,graphs:io.rows})
 const failure=await processInboundEdielMessage({actorUserId:actor,edielMessageId:io.source.id}).catch(error=>error)
 expect.soft(failure).toBeInstanceOf(EdielExecutionFailure)
 expect.soft(failure).toMatchObject({disposition:{kind:'security_quarantine',code:denial==='membership'?'EDIEL_TENANT_ACTOR_FORBIDDEN':'EDIEL_TENANT_PERMISSION_FORBIDDEN'},
  message:denial==='membership'?'ediel_tenant_actor_forbidden':'ediel_tenant_permission_forbidden'})
 expect.soft(io.status).toBeNull();expect({source:io.source,graphs:io.rows}).toEqual(before)
 expect(io.writes).toEqual([])
})
it('declared protected A source/legal/registry READs pass the actual decoders without granting operational policy',async()=>{
 qualified()
 const basis=await requireEdielInboundLegalContext(company,io.source.id)
 expect(basis.companyId).toBe(company);expect(basis.legalEdielId).toBe('54321')
 const evidence=await resolveCanonicalRulePack({family:'PRODAT',messageCode:'Z04',transactionSubtype:'A',direction:'inbound',
  applicationReference:'23-DDQ-PRODAT',businessDate:'2026-09-20',requireBuilder:false,requireStateMachine:false})
 expect(evidence.messageProfileId).toBe(io.source.rule_profile_version_id)
 expect(evidence.rulePackId).toBe(io.source.canonical_rule_pack_id)
 expect(evidence.sourceHash).toBe(io.source.rule_pack_checksum)
 expect(evidence.originalSnapshot).toEqual(io.registry[0].original_snapshot)
 expect(io.writes).toEqual([])
})
it('the actual qualified actor invocation owns only a negative R210 response and genuine structural register evidence',async()=>{
 qualified();const before=structuredClone({source:io.source,graphs:io.rows})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,actorFacts())
 expect.soft(io.calls.map(call=>call.name)).toEqual(expect.arrayContaining(['ediel_require_inbound_legal_context_v1',
  'resolve_canonical_ediel_rule_pack_with_witness_v1','gridex_actor_has_company_permission']))
 expect.soft(io.calls.some(call=>call.name==='gridex_actor_has_company_permission'&&call.args.p_permission==='communication.read')).toBe(true)
 expect.soft(own210(decision.issues)).toBe(true);expect.soft(decision.policy).toBeNull()
 expect.soft(decision.applicationDecision).toBe('rejected');expect.soft(decision.functionalDecision).toBe('not_applicable')
 expect.soft(readReceivedCanonicalProdatApplicationObjects(decision,io.source)).toBeNull()
 expect.soft(readReceivedCanonicalProdatSourceFunction(decision,io.source)).toBeNull()
 expect.soft(decision.prodatRegisterValidation).toMatchObject({version:1,owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only'})
 expect.soft(bindReceivedRegisterValidation(decision.prodatRegisterValidation,io.source.raw_payload!)).not.toBeNull()
 const response=readReceivedCanonicalProdatResponseValidation(decision,io.source)
 expect.soft(response?.responses).toEqual(expect.arrayContaining([expect.objectContaining({ercCode:'41',fieldCode:'210',id:'735123456789012345',li:'CASE-1'})]))
 expect.soft(response?.responses.some(row=>row.ercCode==='100')).toBe(false)
 const evidence=buildReceivedSourceValidationEvidence({original:io.source,validated:io.source,resolvedCompanyId:company,decision})
 expect.soft(evidence).not.toBeNull()
 expect.soft(evidence?.prodatResponseValidation).toEqual(response)
 expect.soft(evidence?.prodatObjectValidation).toBeUndefined();expect.soft(evidence?.prodatApplicationValidation).toBeUndefined()
 expect.soft(evidence?.prodatSourceFunctionValidation).toBeUndefined()
 expect(io.writes).toEqual([]);expect({source:io.source,graphs:io.rows}).toEqual(before)
 expect(response).not.toBeNull()
})
it('an actorless physical R210 observation cannot mint a response owner even with declared qualified READ inputs',async()=>{
 qualified();const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source)
 expect(readReceivedCanonicalProdatResponseValidation(decision,io.source)).toBeNull()
 expect(readReceivedCanonicalProdatApplicationObjects(decision,io.source)).toBeNull()
 expect(readReceivedCanonicalProdatSourceFunction(decision,io.source)).toBeNull()
 expect(io.calls.some(call=>call.name==='ediel_require_inbound_legal_context_v1')).toBe(false)
 expect(io.writes).toEqual([])
})
it('a copied policy-null rejection cannot mint any response/full-object/APP/function facet',async()=>{
 qualified();const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,actorFacts())
 expect(readReceivedCanonicalProdatResponseValidation(decision,io.source)).not.toBeNull()
 const copy=structuredClone(decision)
 expect(readReceivedCanonicalProdatResponseValidation(copy,io.source)).toBeNull()
 const evidence=buildReceivedSourceValidationEvidence({original:io.source,validated:io.source,resolvedCompanyId:company,decision:copy})
 expect(evidence?.prodatResponseValidation).toBeUndefined();expect(evidence?.prodatApplicationValidation).toBeUndefined()
 expect(evidence?.prodatSourceFunctionValidation).toBeUndefined();expect(io.writes).toEqual([])
 expect(evidence?.prodatObjectValidation).toBeUndefined()
})
it('a copied decision plus a new real READ cannot replace a fresh actual structural register invocation',async()=>{
 qualified();const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,actorFacts())
 expect(readReceivedCanonicalProdatResponseValidation(decision,io.source)).not.toBeNull()
 const token=await loadReceivedZ04RequiredStartRejection(io.source,actor)
 expect(token).not.toBeNull();const copy=structuredClone(decision)
 expect(ownReceivedZ04RequiredStartRejection(copy,io.source,actor,token!)).toBe(false)
 expect(hasReceivedZ04RequiredStartRejection(copy,io.source,actor)).toBe(false)
 expect(io.writes).toEqual([])
})
it.each(['copy','wrong actor','expired','changed source'] as const)('the actual protected READ token refuses %s redemption',async adverse=>{
 qualified();const token=await loadReceivedZ04RequiredStartRejection(io.source,actor)
 expect(token).not.toBeNull();expect(readReceivedZ04RequiredStartWitness(token!,io.source,actor)).not.toBeNull()
 const candidate=adverse==='copy'?structuredClone(token!):token!
 const source=adverse==='changed source'?{...io.source,raw_payload:io.source.raw_payload!+' '}:io.source
 if(adverse==='expired')vi.setSystemTime(new Date(Date.now()+2001))
 expect(readReceivedZ04RequiredStartWitness(candidate,source,adverse==='wrong actor'?foreign:actor)).toBeNull()
 expect(io.writes).toEqual([])
})
it('a consumed actual structural register proof cannot be reused with a later real READ',async()=>{
 qualified();const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,actorFacts())
 expect(hasReceivedZ04RequiredStartRejection(decision,io.source,actor)).toBe(true)
 expect(hasReceivedZ04RequiredStartRejection(decision,io.source,foreign)).toBe(false)
 const token=await loadReceivedZ04RequiredStartRejection(io.source,actor)
 expect(token).not.toBeNull();expect(ownReceivedZ04RequiredStartRejection(decision,io.source,actor,token!)).toBe(false)
 expect(readReceivedZ04RequiredStartWitness(token!,io.source,actor)).toBeNull()
 expect(io.writes).toEqual([])
})
it('the actual captured SQL response validator accepts only the real negative facet, without a ledger or prepare receipt',async()=>{
 qualified();const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,actorFacts())
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
 ['wrong born A profile',()=>{io.rows.ediel_messages[0].rule_profile_key='PRODAT:Z04:D:26.A:r3'}],
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
 qualified();change();const before=structuredClone({source:io.source,graphs:io.rows})
 // Current execution denials retain their actual security taxonomy, stronger
 // than a missing/unknown authority hold. Collect once only to observe writes.
 let failure:unknown
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,actorFacts()).catch(error=>{failure=error;return null})
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
it('invalid full syntax preserves syntax rejection before the new required-start authority reads',async()=>{
 setSource({...message('A'),raw_payload:message('A').raw_payload!.replace(/UNT\+\d+/, 'UNT+999')})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source)
 expect(decision.syntaxDecision).toBe('rejected');expect(io.calls).toEqual([])
})
it.each(['A','D'] as const)('present own start in %s remains a capability hold, never a false missing210 or archived-date substitute',async subtype=>{
 setSource(message(subtype,false));expect(validateEdifactSyntax(io.source).ok).toBe(true)
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source)
 expect(own210(decision.issues)).toBe(false)
 if(subtype==='A')expect(decision.policy).toBeNull()
 else expect(decision.policy?.subtype).toBe('D')
 expect(decision.applicationDecision).not.toBe('accepted');expect(decision.responsePlan.some(p=>p.family==='APERAK'&&p.outcome==='positive')).toBe(false)
})

it('typed bilateral READ security denial propagates unchanged before rejection-only authority',async()=>{
 qualified();const denied=new EdielExecutionFailure({kind:'security_quarantine',code:'DECLARED_CURRENT_BILATERAL_SECURITY'},'declared_current_bilateral_security')
 io.bilateralError=denied;const before=structuredClone({source:io.source,graphs:io.rows})
 await expect(resolveCanonicalRuntimeDecisionWithRegistry(io.source,actorFacts())).rejects.toBe(denied)
 expect(io.calls.map(call=>call.name)).toEqual(['ediel_read_prodat_bilateral_source_capability_v1'])
 expect(io.writes).toEqual([]);expect({source:io.source,graphs:io.rows}).toEqual(before)
})
it('unknown bilateral READ failure retains the prior hold without minting rejection authority',async()=>{
 qualified();io.bilateralError=new Error('DECLARED_UNKNOWN_BILATERAL_READ_FAILURE')
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source,actorFacts())
 expect(decision.policy).toBeNull();expect(decision.applicationDecision).not.toBe('accepted')
 expect(readReceivedCanonicalProdatResponseValidation(decision,io.source)).toBeNull()
 expect(io.calls.map(call=>call.name)).toEqual(['ediel_read_prodat_bilateral_source_capability_v1']);expect(io.writes).toEqual([])
})

it.each(['id','environment','raw_payload'] as const)('actual actor denial precedes unavailable %s accessor',async field=>{
 qualified();io.permission=false
 const stored=structuredClone(io.rows),unavailable=new Error('DECLARED_UNAVAILABLE_BORN_ACCESSOR')
 Object.defineProperty(io.source,field,{enumerable:true,configurable:true,get(){throw unavailable}})
 const failure=await loadReceivedZ04RequiredStartRejection(io.source,actor).catch(error=>error)
 expect(failure).toBeInstanceOf(EdielExecutionFailure)
 expect(failure).toMatchObject({disposition:{kind:'security_quarantine',code:'EDIEL_TENANT_PERMISSION_FORBIDDEN'}})
 expect(io.calls.filter(call=>call.name==='gridex_actor_has_company_permission').map(call=>call.args))
  .toEqual([{p_actor_user_id:actor,p_company_id:company,p_permission:'communication.read'}])
 expect(io.sourceQueryFilters).toEqual([])
 expect(io.calls.filter(call=>call.name==='ediel_require_inbound_legal_context_v1')).toEqual([])
 expect(io.rows).toEqual(stored);expect(io.writes).toEqual([])
})
it.each(['id','environment','raw_payload'] as const)('allowed actor refuses unavailable %s accessor without a protected READ',async field=>{
 qualified()
 const stored=structuredClone(io.rows),unavailable=new Error('DECLARED_UNAVAILABLE_BORN_ACCESSOR')
 Object.defineProperty(io.source,field,{enumerable:true,configurable:true,get(){throw unavailable}})
 const token=await loadReceivedZ04RequiredStartRejection(io.source,actor)
 expect(token).toBeNull()
 expect(io.calls.filter(call=>call.name==='gridex_actor_has_company_permission').map(call=>call.args))
  .toEqual([{p_actor_user_id:actor,p_company_id:company,p_permission:'communication.read'}])
 expect(io.sourceQueryFilters).toEqual([])
 expect(io.calls.filter(call=>call.name==='ediel_require_inbound_legal_context_v1')).toEqual([])
 expect(io.rows).toEqual(stored);expect(io.writes).toEqual([])
})
it.each([false,true])('unused source accessor stays unread with actual actor permission %s',async allowed=>{
 qualified();io.permission=allowed
 const stored=structuredClone(io.rows)
 let getterReads=0
 Object.defineProperty(io.source,'parsed_payload',{enumerable:true,configurable:true,get(){
  getterReads++;throw new Error('UNUSED_SOURCE_GETTER_MUST_NOT_RUN')
 }})
 const outcome=await loadReceivedZ04RequiredStartRejection(io.source,actor).catch(error=>error)
 expect(getterReads).toBe(0)
 expect(io.calls.filter(call=>call.name==='gridex_actor_has_company_permission').map(call=>call.args))
  .toEqual([{p_actor_user_id:actor,p_company_id:company,p_permission:'communication.read'}])
 if(allowed){
  expect(outcome).not.toBeInstanceOf(Error);expect(outcome).not.toBeNull()
  expect(readReceivedZ04RequiredStartWitness(outcome,io.source,actor)).not.toBeNull()
  expect(io.sourceQueryFilters).toEqual([{key:'id',value:io.bornSourceId},{key:'company_id',value:company}])
 }else{
  expect(outcome).toBeInstanceOf(EdielExecutionFailure)
  expect(outcome).toMatchObject({disposition:{kind:'security_quarantine',code:'EDIEL_TENANT_PERMISSION_FORBIDDEN'}})
  expect(io.sourceQueryFilters).toEqual([])
  expect(io.calls.filter(call=>call.name==='ediel_require_inbound_legal_context_v1')).toEqual([])
 }
 expect(io.rows).toEqual(stored);expect(io.writes).toEqual([])
})
