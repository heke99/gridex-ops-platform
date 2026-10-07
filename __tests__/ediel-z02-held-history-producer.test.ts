// OUTSIDE-GIT prospective unit candidate. Explicit synthetic public IO ports; no native/source authority credit.
// Declared database/registry/identity ports exercise the actual coordinator,
// syntax, complete national field engine, opaque owner, ledger and renderer.
// These unit probes do not prove native replay, authentic sources or transport.
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({message:{} as EdielMessageRow,tables:{} as Record<string,Record<string,unknown>[]>,
 calls:[] as {name:string;args:Record<string,unknown>}[],trace:[] as string[],events:[] as Record<string,unknown>[],
 drafts:[] as Record<string,unknown>[],updates:0,readFailure:false,effectFailure:false,copyDecision:false,
 domainResult:null as Record<string,unknown>|null,domainAckFailure:false,followupFailure:false,
 retained:null as Record<string,unknown>|null,append:null as Record<string,unknown>|null,
 actualDecision:null as import('@/lib/ediel/core/runtimeDecision').CanonicalRuntimeDecision|null,
 readKind:'null' as 'null'|'denied'|'undefined'|'malformed'|'falseError'|'zeroError'|'emptyError'|'undefinedError'|'nanError'|'missingError'|'thrown', runtimeMessage:null as EdielMessageRow|null, runtimeActive:false, tableError:'', mutationStage:'' as string, mutationApplied:0, permissions:{} as Record<string,boolean>, permissionError:'', registryFailure:false, registryKind:'valid', mixedConcurrent:false, executorActor:'' as string, mutation:'' as string, unconfirmed:false, captureFailure:false, deliveredDecision:null as import('@/lib/ediel/core/runtimeDecision').CanonicalRuntimeDecision|null}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(name:string,args:Record<string,unknown>)=>sourceRpc(name,args),from:(table:string)=>tablePort(table)}}))
// Pass through the actual runtime with original arguments/result identity.
// Mutation probes act only while this actual invocation is awaiting its ports.
vi.mock('@/lib/ediel/core/runtimeDecision',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/ediel/core/runtimeDecision')>()
 return {...actual,resolveCanonicalRuntimeDecisionWithRegistry:async(...args:Parameters<typeof actual.resolveCanonicalRuntimeDecisionWithRegistry>)=>{
  io.runtimeMessage=args[0];io.runtimeActive=true;
  try{const result=await actual.resolveCanonicalRuntimeDecisionWithRegistry(...args);io.actualDecision=result;
   return io.deliveredDecision=io.copyDecision?structuredClone(result):result
  }finally{io.runtimeActive=false}
 }}
})
vi.mock('@/lib/ediel/tenant/resolveInboundTenant',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/ediel/tenant/resolveInboundTenant')>()
 return {...actual,resolveInboundTenantFromIdentifiers:async(input:Record<string,unknown>)=>{
  io.trace.push('tenant-identifiers')
  if(io.message.message_family!=='PRODAT')return {status:'unresolved',companyId:null,evidence:[],candidateCompanyIds:[],reasons:['Declared no current tenant hint'],warnings:[]}
  expect(input.receiverEdielId).toBe('12345');expect(input.marketActorEdielId).toBe('12345')
  return {status:'resolved',companyId:company,evidence:[{companyId:company,source:'verified_legal_identity',score:300,details:{declared:true}}],candidateCompanyIds:[company],reasons:[],warnings:[]}
 }}
})
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>io.message,
 createEdielMessageEvent:async(input:Record<string,unknown>)=>{io.events.push(input)},
 updateEdielMessageStatus:async(input:{status:string;parsedPayload?:Record<string,unknown>;validationReport?:Record<string,unknown>})=>{
  io.updates++;io.message={...io.message,status:input.status,parsed_payload:structuredClone(input.parsedPayload??io.message.parsed_payload),validation_report:structuredClone(input.validationReport??io.message.validation_report)} as EdielMessageRow
  io.tables.ediel_messages=[io.message as unknown as Record<string,unknown>];return io.message
 },linkEdielMessage:async()=>{throw Error('Legacy single-target writer must not run')},
 listAckMessagesForSource:async()=>[],getEdielRouteProfileByCommunicationRouteId:async()=>null,listEdielMessagesByIds:async()=>[]}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:async(input:{ackFamily:string;draft:Record<string,unknown>})=>{
 io.drafts.push(input.draft);throw Error('No ACK mutation permitted in this held-history model')
}}))
vi.mock('@/lib/ediel/outbox/createOutboxItem',()=>({createOutboxItem:async()=>{throw Error('No outbox permitted')}}))
// The committed ACK adapter has independent actual native/body composition
// tests. Here its external receipt port exposes coordinator ordering only.
vi.mock('@/lib/ediel/flows/receivedProdatStructuralAcks',()=>({createReceivedProdatCommittedEffectAcks:async(input:Record<string,unknown>)=>{
 io.trace.push('committed-domain-ack');expect(input).toEqual({actorUserId:actor,companyId:company,sourceMessageId:io.message.id})
 if(io.domainAckFailure)throw Error('Declared committed ACK projection failure')
 return [id(98)]
}}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>null}))
vi.mock('@/lib/ediel/inboundCases',()=>({createOrUpdateInboundProdatCase:async()=>{io.trace.push('source-bound-case');return {id:'declared-case'}}}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:async()=>null}))
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointForEdielMessage:async()=>{throw Error('Unexpected legacy matching')},matchSiteAndCustomerForMeteringPoint:async()=>null,findMatchingSupplierSwitchRequest:async()=>null}))
vi.mock('@/lib/ediel/operationalVerification',()=>({buildSafeMasterdataProposal:async()=>[]}))
vi.mock('@/lib/onboarding/inboundEdielLinking',()=>({applyInboundProdatZ02ToCustomerInfoRequest:async()=>{throw Error('Held source must not reach Z02 application')},applyInboundProdatZ14ToMeteringPermission:async()=>null}))
vi.mock('@/lib/operations/db',()=>({createSupplierSwitchEvent:async()=>null}))
vi.mock('@/lib/ediel/flows/inboundBusinessStateMachine',()=>({applyInboundBusinessStateMachine:async()=>{throw Error('Unexpected legacy E business state machine')}}))


import {resolveCanonicalRuntimeDecision,resolveCanonicalRuntimeDecisionWithRegistry,readReceivedCanonicalProdatApplicationObjects,readReceivedCanonicalProdatSourceFunction,readReceivedCanonicalProdatResponseValidation,hasReceivedCanonicalProdatPartialOwner} from '@/lib/ediel/core/runtimeDecision'
import {resolveCanonicalRulePack} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {fetchReceivedZ02EndUserAddressContext} from '@/lib/ediel/prodat/receivedZ02EndUserAddressContext'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {source} from '@/__tests__/fixtures/prodat-identity'
import {raw,line,characteristic,type Parts} from '@/__tests__/fixtures/prodat-register'
import {ownerRulePack} from '@/__tests__/helpers/sourceOwnerFixtures'
import {externalZ02Reply} from '@/scripts/helpers/ediel-z02-supplier-native-wire'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,company=id(2),actor=id(50),point='735123456789012345'
let variant:'L'|'LK'='L',original:EdielMessageRow
function registryRow(){
 const row=ownerRulePack(),subtype=variant,reason=variant==='L'?'Z22':'Z23',key=`PRODAT:Z02:${subtype}:26.A:r3`
 Object.assign(row,{profile_key:key,profile:{...row.profile,messageCode:'Z02',transactionSubtype:subtype,reasonForTransaction:reason}})
 Object.assign(row.original_snapshot.messageProfile,{profile_key:key,profile:row.profile})
 if(io.registryKind==='subtype')row.profile.transactionSubtype='A'
 if(io.registryKind==='date')row.valid_from='2027-04-01'
 if(io.registryKind==='version')row.original_version='26.A:r99'
 if(io.registryKind==='snapshot')row.original_snapshot.messageProfile.rule_pack_id=id(99)
 if(io.registryKind==='hash')row.source_hash='invalid'
 return row
}
function sourceRpc(name:string,args:Record<string,unknown>){
 io.calls.push({name,args});io.trace.push(name)
 const hash=(field:string)=>typeof args[field]==='string'?evidenceHash(args[field] as string):null
 let data:unknown=null,error:unknown=null
 if(name==='gridex_ediel_received_z02_address_source_basis_v1'){
  expect(args).toEqual({p_source_message_id:original.id,p_actor_user_id:io.executorActor||actor})
  if((io.executorActor&&io.executorActor!==actor))error={code:'42501',message:'Declared foreign actor denied'}
  else if(io.readKind==='denied')error={code:'42501',message:'Declared current READ denied'}
  else if(io.readKind==='undefined')data=undefined
  else if(io.readKind==='malformed')data={status:'z02_address_source_basis',version:1}
  else if(io.readKind==='falseError')error=false
  else if(io.readKind==='zeroError')error=0
  else if(io.readKind==='emptyError')error=''
  else if(io.readKind==='undefinedError')error=undefined
  else if(io.readKind==='nanError')error=NaN
  else if(io.readKind==='thrown')throw Error('Declared original READ threw')
  if(io.mixedConcurrent&&io.calls.filter(c=>c.name===name).length===2)error={code:'42501',message:'Declared second invocation READ denied'}
  mutateAt('READ')
 }else if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){
  expect(args).toEqual({p_market:'electricity',p_family:'PRODAT',p_message_code:'Z02',p_transaction_subtype:variant,p_direction:'inbound',p_business_date:'2026-10-06'})
  mutateAt('REGISTRY');if(io.registryFailure)error={code:'P0001',message:'Declared registry unavailable'};else if(io.registryKind==='missing')data=null;else if(io.registryKind==='malformed')data=[{}];else data=[registryRow()]
 }else if(name==='ediel_read_technical_source_endpoint_v2')data=null
 else if(name==='gridex_actor_has_company_permission'){mutateAt('AUTH');data=args.p_actor_user_id===actor&&args.p_company_id===company&&io.permissions[String(args.p_permission)]===true;if(io.permissionError===args.p_permission)error={code:'42501',message:'Declared current permission RPC error'}}
 else if(name==='gridex_read_outbound_acks_for_source_v2')data={version:2,executionActorUserId:args.p_actor_user_id,executionPhase:args.p_phase,sourceMessageId:original.id,sourcePayloadHash:evidenceHash(original.raw_payload!),environment:'test',companyId:company,originals:[]}
 else if(name==='gridex_record_prodat_source_validation_v6'){
  const facts=JSON.parse(String(args.p_facts_text));expect(facts).toMatchObject({owner:'canonical-runtime-with-registry-v1',syntaxDecision:'accepted',applicationDecision:'manual_review',functionalDecision:'manual_review',sourceDisposition:'not_established'})
  expect(args.p_company_id).toBe(company);expect(args.p_source_message_id).toBe(original.id);expect(args.p_source_payload_hash).toBe(evidenceHash(original.raw_payload!))
  expect(args.p_source_function_facts_text).toBeNull();expect(args.p_application_facts_text).toBeNull();expect(args.p_response_facts_text).toBeNull()
  io.append=structuredClone(args)
  data={version:6,companyId:company,environment:'test',sourceMessageId:original.id,sourcePayloadHash:args.p_source_payload_hash,factsHash:io.unconfirmed?'wrong':hash('p_facts_text'),sourceDisposition:'not_established',assessmentId:id(77),objectFactsHash:hash('p_object_facts_text'),applicationFactsHash:null,responseFactsHash:null,sourceFunctionFactsHash:null,ignoredFieldsHash:hash('p_ignored_fields_text')}
 }else if(name==='ediel_probe_source_rule_pack_capture_v1'){
  expect(io.append).not.toBeNull();const facts=JSON.parse(String(io.append!.p_facts_text)),row=registryRow()
  expect(facts.rulePackEvidence).toMatchObject({profileKey:row.profile_key,messageProfileId:row.message_profile_id,rulePackId:row.rule_pack_id,sourceHash:row.source_hash,version:row.original_version,snapshot:row.original_snapshot})
  if(io.captureFailure)error=Error('Declared capture refused')
  else data={status:'captured',evidence:{rulePackId:row.rule_pack_id,messageProfileId:row.message_profile_id,profileKey:row.profile_key,version:row.original_version,sourceHash:row.source_hash,snapshot:{profileKey:row.profile_key,profileVersionId:row.message_profile_id,version:row.original_version,checksum:row.source_hash,...row.original_snapshot}}}
 }else throw Error('UNDECLARED_PUBLIC_PORT:'+name)
 const p=Promise.resolve(io.readKind==='missingError'&&name==='gridex_ediel_received_z02_address_source_basis_v1'?{data}:{data,error});return Object.assign(p,{abortSignal:()=>p})
}
function tablePort(table:string){
 io.trace.push('table:'+table)
 const filters:((row:Record<string,unknown>)=>boolean)[]=[],rows=()=> (io.tables[table]??[]).filter(row=>filters.every(test=>test(row)))
 let values:Record<string,unknown>|undefined,inserted:Record<string,unknown>|undefined,columns='*'
 const result=(single=false)=>{
  let selected=rows();if(values){selected.forEach(row=>Object.assign(row,values));if(table==='ediel_messages')io.message=selected[0] as unknown as EdielMessageRow}
  if(inserted){const row={id:id(80),...inserted};(io.tables[table]??=[]).push(row);selected=[row];inserted=undefined}
  const data=selected.map(row=>columns==='*'?structuredClone(row):Object.fromEntries(columns.split(',').map(key=>[key,row[key]])))
  return {data:single?data[0]??null:data,error:io.tableError===table?{code:'42501',message:'Declared current actor table unavailable'}:null,count:data.length}
 }
 const q={select:(value='*')=>{columns=value;return q},eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return q},
  in:(key:string,value:unknown[])=>{filters.push(row=>value.includes(row[key]));return q},not:(key:string,_operator:string,value:unknown)=>{filters.push(row=>row[key]!==value);return q},
  limit:()=>q,abortSignal:()=>q,update:(value:Record<string,unknown>)=>{values=value;return q},insert:(value:Record<string,unknown>)=>{inserted=value;return q},
  maybeSingle:async()=>result(true),single:async()=>result(true),then:(resolve:(value:ReturnType<typeof result>)=>unknown)=>Promise.resolve(result()).then(resolve)}
 return q
}

function fixture(next:'L'|'LK'){
 variant=next;const reason=next==='L'?'Z22':'Z23'
 const parts:Parts[]=[['NAD','FR',['12345','160','SVK'],'','','','','','','SE'],['NAD','DO',['54321','160','SVK'],'','','','','','','SE'],line('1',point,undefined,'9'),['DTM',['92','202611010000','203']],...characteristic('Z13',reason),['RFF',['Z05','NET']],['RFF',['LI','DECLARED-LI']],['NAD','UD',['199001011234','SE2','260'],'','Synthetic',['Street'],'Town','','12345','SE']]
 const business=tokenizeEdifact(raw(parts,'Z01')).segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s=>s.raw)
 const request=EdifactEnvelopeCodec.encode({sender:'12345',receiver:'54321',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'SYNTHETIC-I',applicationReference:'23-DDQ-PRODAT',environment:'test',acknowledgementRequest:false,createdAt:new Date('2026-10-06T12:00:00Z'),messages:[{messageReference:'SYNTHETIC-M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:business}]})
 const wire=externalZ02Reply({source:{rawPayload:request},interchangeReference:'REPLY-I',messageReference:'REPLY-M',documentReference:'REPLY-D',documentMinute:'202610061203',createdAt:new Date('2026-10-06T12:03:00Z'),measurementMethod:'Z03',customerAddress:{street:'Street',city:'Town',postalCode:'12345',country:'SE'},installationAddress:{street:'Installation',city:'Town',postalCode:'12345',country:'SE'}})
 original={...source(wire,'Z02'),id:id(1),company_id:company,status:'received',message_received_at:'2026-10-06T12:03:00Z',immutable_payload_hash:evidenceHash(wire),customer_id:id(3),site_id:id(4)} as EdielMessageRow
 original.execution_context_snapshot={receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:original.id,companyId:company,environment:'test',messageCode:'Z02',payloadHash:evidenceHash(wire),sourceReceivedAt:original.message_received_at,capturedAt:original.message_received_at}}
 io.message=structuredClone(original);io.tables.ediel_messages=[io.message as unknown as Record<string,unknown>]
 return structuredClone(original)
}
function mutateAt(stage:string){
 if(!io.runtimeActive||!io.mutation||io.mutationStage!==stage||io.mutationApplied||!io.runtimeMessage)return
 io.mutationApplied++;const m=io.runtimeMessage
 if(io.mutation==='hash')(m as EdielMessageRow&{immutable_payload_hash?:unknown}).immutable_payload_hash='b'.repeat(64)
 else if(io.mutation==='raw')m.raw_payload+=' '
 else if(io.mutation==='company')m.company_id=id(99)
 else if(io.mutation==='clock')m.message_received_at='2026-10-06T12:03:00.000001Z'
 else if(io.mutation==='customer')m.customer_id=id(99)
 else if(io.mutation==='site')m.site_id=id(99)
 else if(io.mutation==='grid')m.grid_owner_id=id(99)
 else if(io.mutation==='environment')m.environment='production'
 else if(io.mutation==='application')m.application_reference='FOREIGN'
 else if(io.mutation==='direction')m.direction='outbound'
 else if(io.mutation==='identity')m.id=id(99)
 else if(io.mutation==='standard')m.message_standard='xml'
 else if(io.mutation==='family')m.message_family='UTILTS'
 else if(io.mutation==='code')m.message_code='Z14'
 else if(io.mutation==='clockInvalid')m.message_received_at='2026-02-30T12:03:00Z'
 else if(io.mutation==='contextId')((m.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}).receivedProdatContext).sourceMessageId=id(99)
 else if(io.mutation==='contextHash')((m.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}).receivedProdatContext).payloadHash='b'.repeat(64)
 else if(io.mutation==='contextClock')((m.execution_context_snapshot as {receivedProdatContext:Record<string,unknown>}).receivedProdatContext).sourceReceivedAt='2026-10-06T12:03:00.000001Z'
 else if(io.mutation==='seal')m.execution_context_snapshot={receivedProdatContext:{version:1,contextOrigin:'caller'}}
}
const calls=(name:string)=>io.calls.filter(x=>x.name===name)
const run=()=>processInboundEdielMessage({actorUserId:io.executorActor||actor,edielMessageId:io.message.id})
function held(before:EdielMessageRow){
 expect(io.actualDecision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'manual_review',functionalDecision:'manual_review',prodatProcessingDisposition:{kind:'internal_review'}})
 expect(io.actualDecision!.issues.some(i=>i.code==='RECEIVED_Z02_END_USER_ADDRESS_SOURCE_UNAVAILABLE')).toBe(true)
 expect(io.actualDecision!.responsePlan.filter(x=>x.family==='APERAK')).toEqual([])
 expect(io.message.raw_payload).toBe(before.raw_payload);expect((io.message as EdielMessageRow & {immutable_payload_hash?:unknown}).immutable_payload_hash).toBe((before as EdielMessageRow & {immutable_payload_hash?:unknown}).immutable_payload_hash)
 expect(io.message.execution_context_snapshot).toEqual(before.execution_context_snapshot)
 expect(io.drafts.every(d=>d.messageFamily==='CONTRL')).toBe(true);expect(io.trace).not.toContain('source-bound-case')
}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-06T12:03:00Z'));io.calls=[];io.trace=[];io.events=[];io.drafts=[];io.updates=0;io.append=null;io.actualDecision=null;io.deliveredDecision=null;io.copyDecision=false;io.mutation='';io.executorActor='';io.unconfirmed=false;io.captureFailure=false;io.readKind='null';io.runtimeMessage=null;io.runtimeActive=false;io.tableError='';io.mutationStage='';io.mutationApplied=0;io.permissions={'ediel.read':true,'communication.read':true,'communication.write':true,'ediel_testing.write':true};io.permissionError='';io.registryFailure=false;io.registryKind='valid';io.mixedConcurrent=false;io.tables={user_profiles:[{id:actor,user_status:'active'}],company_memberships:[{company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:'2026-01-01T00:00:00Z'}]}})
afterEach(()=>vi.useRealTimers())

it.each((['L','LK'] as const).flatMap(v=>(['edielOnly','communicationOnly','both'] as const).map(limb=>[v,limb] as const)))('qualified original NULL %s completes held history with current READ %s',async(v,limb)=>{
 const before=fixture(v);io.permissions['ediel.read']=limb!=='communicationOnly';io.permissions['communication.read']=limb!=='edielOnly'
 await run();held(before)
 expectCurrentNullSemantics()
 expect(calls('gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(1)
 expect(calls('resolve_canonical_ediel_rule_pack_with_witness_v1'),'same-invocation registry missing').toHaveLength(1)
 expect(calls('gridex_record_prodat_source_validation_v6')).toHaveLength(1);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toHaveLength(1)
 expect(calls('gridex_actor_has_company_permission').map(c=>c.args.p_permission)).toEqual(expect.arrayContaining(['ediel.read','communication.read']))
 expect(io.trace.indexOf('gridex_ediel_received_z02_address_source_basis_v1')).toBeLessThan(io.trace.indexOf('resolve_canonical_ediel_rule_pack_with_witness_v1'))
 expect(io.trace.indexOf('gridex_record_prodat_source_validation_v6')).toBeLessThan(io.trace.indexOf('ediel_probe_source_rule_pack_capture_v1'))
 const object=JSON.parse(String(io.append!.p_object_facts_text));expect(object.sharedAccepted).toBe(false);expect(object.objects.every((x:{disposition:string})=>x.disposition==='unavailable')).toBe(true)
 for(const decision of [io.actualDecision!,structuredClone(io.actualDecision!)]){
  expect(readReceivedCanonicalProdatApplicationObjects(decision,before)).toBeNull();expect(readReceivedCanonicalProdatSourceFunction(decision,before)).toBeNull();expect(readReceivedCanonicalProdatResponseValidation(decision,before)).toBeNull();expect(hasReceivedCanonicalProdatPartialOwner(decision,before)).toBe(false)
 }
})
it.each(['denied','undefined','malformed','thrown'] as const)('actual %s READ cannot masquerade as qualified NULL',async kind=>{
 const before=fixture('L');io.readKind=kind;await run();held(before)
 expect(calls('gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(1)
 expect(calls('gridex_record_prodat_source_validation_v6')).toEqual([]);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
})
it.each(['hash','raw','company','clock','customer','site','grid','environment','application','direction','identity','seal','standard','family','code','clockInvalid','contextId','contextHash','contextClock'] as const)('mutation %s inside actual original READ cannot mint held history',async change=>{
 fixture('L');io.mutation=change;io.mutationStage='READ';await run()
 expect(io.mutationApplied).toBe(1);expect(io.actualDecision!.applicationDecision).toBe('manual_review')
 expect(calls('gridex_record_prodat_source_validation_v6')).toEqual([]);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
})
it.each((['AUTH','REGISTRY'] as const).flatMap(stage=>(['hash','raw','company','clock','customer','site','grid','environment','application','direction','identity','seal','standard','family','code','clockInvalid','contextId','contextHash','contextClock'] as const).map(change=>[stage,change] as const)))('mutation inside actual awaited %s of %s stops history',async(stage,change)=>{
 fixture('L');io.mutation=change;io.mutationStage=stage;await run()
 expect(io.mutationApplied,'target awaited port not reached').toBe(1)
 expect(calls('gridex_record_prodat_source_validation_v6')).toEqual([]);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
})
it('a previous NULL read cannot qualify a later denied replay of same source',async()=>{
 fixture('L');await run();const firstReads=calls('gridex_ediel_received_z02_address_source_basis_v1').length
 const captureCount=calls('ediel_probe_source_rule_pack_capture_v1').length;io.readKind='denied';await run()
 expect(calls('gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(firstReads+1)
 expect(calls('ediel_probe_source_rule_pack_capture_v1')).toHaveLength(captureCount)
})

it('foreign execution actor cannot consume another actor original NULL history',async()=>{
 fixture('L');io.executorActor=id(99);await run()
 expect(calls('gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(1)
 expect(calls('gridex_record_prodat_source_validation_v6')).toEqual([]);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
})
it('explicit finite client NULL does not qualify the default producer READ',async()=>{
 const before=fixture('L');const supplied=vi.fn(async()=>({data:null,error:null}))
 expect(await fetchReceivedZ02EndUserAddressContext({message:io.message,actorUserId:actor,client:{rpc:supplied}})).toBeUndefined()
 expect(supplied).toHaveBeenCalledOnce();expect(io.calls).toEqual([])
 io.readKind='denied';await run();held(before)
 expect(calls('gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(1)
 expect(calls('gridex_record_prodat_source_validation_v6')).toEqual([]);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
})
it('two independently qualified concurrent NULL invocations may each capture truthful held history',async()=>{
 fixture('L');await Promise.all([run(),run()])
 expect(calls('gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(2)
 expect(calls('resolve_canonical_ediel_rule_pack_with_witness_v1'),'same-invocation registry missing').toHaveLength(2)
 expect(calls('gridex_record_prodat_source_validation_v6')).toHaveLength(2);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toHaveLength(2)
})
it('a concurrent denied READ cannot borrow the other invocation NULL history',async()=>{
 fixture('L');io.mixedConcurrent=true;await Promise.all([run(),run()])
 expect(calls('gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(2)
 expect(calls('resolve_canonical_ediel_rule_pack_with_witness_v1'),'only own NULL witness missing').toHaveLength(1)
 expect(calls('gridex_record_prodat_source_validation_v6')).toHaveLength(1);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toHaveLength(1)
})
it.each(['unconfirmed','captureFailure'] as const)('qualified held history propagates %s without claiming capture success',async failure=>{
 fixture('L');io[failure]=true
 const outcome=await run().then(()=>({ok:true,error:null}),error=>({ok:false,error}));expectCurrentNullSemantics()
 expect(calls('gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(1)
 expect(calls('resolve_canonical_ediel_rule_pack_with_witness_v1'),'same-invocation registry missing').toHaveLength(1)
 expect(calls('gridex_record_prodat_source_validation_v6')).toHaveLength(1)
 expect(outcome.ok).toBe(false)
 if(failure==='unconfirmed')expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
 else expect(calls('ediel_probe_source_rule_pack_capture_v1')).toHaveLength(1)
 expect(io.drafts.every(d=>d.messageFamily==='CONTRL')).toBe(true)
})

it('declared registry fixture decodes through actual locked-source owner without asserting legal acceptance',async()=>{
 fixture('L');const pure=resolveCanonicalRuntimeDecision(io.message);expect(pure.policy).not.toBeNull()
 const policy=pure.policy!
 const evidence=await resolveCanonicalRulePack({family:'PRODAT',messageCode:policy.code,transactionSubtype:policy.subtype,applicationReference:policy.applicationReference,direction:'inbound',businessDate:policy.referenceDate,canonicalPolicy:policy,requireBuilder:false,requireStateMachine:true})
 expect(evidence).toMatchObject({databaseProfileKey:'PRODAT:Z02:L:26.A:r3',rulePackId:id(12),messageProfileId:id(11),originalVersion:'26.A:r3'})
 expect(calls('gridex_record_prodat_source_validation_v6')).toEqual([]);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
})

it.each(['falseError','zeroError','emptyError','undefinedError','missingError','nanError'] as const)('strict helper rejects malformed NULL result %s instead of returning unknown',async kind=>{
 fixture('L');io.readKind=kind
 await expect(fetchReceivedZ02EndUserAddressContext({message:io.message,actorUserId:actor})).rejects.toThrow('received_z02_end_user_address_source_unavailable')
 expect(calls('gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(1)
})
it.each(['falseError','zeroError','emptyError','undefinedError','missingError','nanError'] as const)('malformed NULL %s cannot acquire history via processor',async kind=>{
 const before=fixture('L');io.readKind=kind;await run();held(before)
 expect(calls('resolve_canonical_ediel_rule_pack_with_witness_v1')).toEqual([]);expect(calls('gridex_record_prodat_source_validation_v6')).toEqual([]);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
})
it.each(['missingMembership','inactiveMembership','unacceptedMembership','foreignMembership','missingProfile','inactiveProfile','wrongProfile','bothFalse','edielRpcError','communicationRpcError','membershipRpcError','profileRpcError'] as const)('actual NULL before SQL actor check cannot qualify history with %s',async denied=>{
 const before=fixture('L')
 if(denied==='missingMembership')io.tables.company_memberships=[]
 if(denied==='inactiveMembership')io.tables.company_memberships[0].is_active=false
 if(denied==='unacceptedMembership')io.tables.company_memberships[0].accepted_at=null
 if(denied==='foreignMembership')io.tables.company_memberships[0].company_id=id(99)
 if(denied==='missingProfile')io.tables.user_profiles=[]
 if(denied==='inactiveProfile')io.tables.user_profiles[0].user_status='inactive'
 if(denied==='wrongProfile')io.tables.user_profiles[0].id=id(99)
 if(denied==='bothFalse'){io.permissions['ediel.read']=false;io.permissions['communication.read']=false}
 if(denied==='edielRpcError')io.permissionError='ediel.read'
 if(denied==='communicationRpcError')io.permissionError='communication.read'
 if(denied==='membershipRpcError')io.tableError='company_memberships'
 if(denied==='profileRpcError')io.tableError='user_profiles'
 await run();held(before);expectCurrentNullSemantics();expect(calls('gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(1)
 expect(calls('resolve_canonical_ediel_rule_pack_with_witness_v1')).toEqual([]);expect(calls('gridex_record_prodat_source_validation_v6')).toEqual([]);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
})
it('actual registry refusal keeps the exact SOURCE_UNAVAILABLE semantic hold without primary/capture',async()=>{
 const before=fixture('L');io.registryFailure=true;await run();held(before);expectCurrentNullSemantics()
 expect(calls('resolve_canonical_ediel_rule_pack_with_witness_v1'),'registry target not reached').toHaveLength(1)
 expect(calls('gridex_record_prodat_source_validation_v6')).toEqual([]);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
})
it('bad full syntax never reads caller actor or caller address context',async()=>{
 fixture('L');const row={...io.message,raw_payload:io.message.raw_payload!.replace('UNT+','UNT+0:')} as EdielMessageRow
 const actorRead=vi.fn(()=>actor),contextRead=vi.fn(()=>{throw Error('caller context must stay unread')})
 const facts=Object.defineProperties({},{actorUserId:{get:actorRead},receivedZ02EndUserAddressContext:{get:contextRead}})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(row,facts)
 expect(decision.syntaxDecision).toBe('rejected');expect(actorRead).not.toHaveBeenCalled();expect(contextRead).not.toHaveBeenCalled();expect(io.calls).toEqual([])
})
it('qualified syntax captures actor once and never reads or spreads caller address context',async()=>{
 fixture('L');const actorRead=vi.fn(()=>actor),contextRead=vi.fn(()=>{throw Error('caller context must stay unread')})
 const facts=Object.defineProperties({},{actorUserId:{get:actorRead},receivedZ02EndUserAddressContext:{get:contextRead}})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.message,facts)
 expect(decision.applicationDecision).toBe('manual_review');expect(actorRead).toHaveBeenCalledOnce();expect(contextRead).not.toHaveBeenCalled()
 expect(calls('gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(1)
})

it.each(['missing','malformed','subtype','date','version','snapshot','hash'] as const)('isolated real registry rejects declared %s evidence',async kind=>{
 fixture('L');io.registryKind=kind;const policy=resolveCanonicalRuntimeDecision(io.message).policy!
 await expect(resolveCanonicalRulePack({family:'PRODAT',messageCode:policy.code,transactionSubtype:policy.subtype,applicationReference:policy.applicationReference,direction:'inbound',businessDate:policy.referenceDate,canonicalPolicy:policy,requireBuilder:false,requireStateMachine:true})).rejects.toThrow()
 expect(calls('gridex_record_prodat_source_validation_v6')).toEqual([]);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
})
it.each(['missing','malformed','subtype','date','version','snapshot','hash'] as const)('held NULL cannot use declared %s registry evidence',async kind=>{
 const before=fixture('L');io.registryKind=kind;await run();held(before);expectCurrentNullSemantics()
 expect(calls('resolve_canonical_ediel_rule_pack_with_witness_v1'),'registry target not reached').toHaveLength(1)
 expect(calls('gridex_record_prodat_source_validation_v6')).toEqual([]);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toEqual([])
})
it.each(['L','LK'] as const)('qualified NULL %s nullable relation scopes remain exact without fabricated defaults',async next=>{
 const before=fixture(next);io.message.customer_id=null;io.message.site_id=null;io.message.grid_owner_id=null
 before.customer_id=null;before.site_id=null;before.grid_owner_id=null
 await run();held(before)
 expect(calls('resolve_canonical_ediel_rule_pack_with_witness_v1'),'same-invocation registry missing').toHaveLength(1)
 expect(calls('gridex_record_prodat_source_validation_v6')).toHaveLength(1);expect(calls('ediel_probe_source_rule_pack_capture_v1')).toHaveLength(1)
})

function semanticDigest(decision:import('@/lib/ediel/core/runtimeDecision').CanonicalRuntimeDecision){
 const projection=structuredClone(decision);delete projection.validationReport.rulePackEvidence
 const ordered=(value:unknown):unknown=>Array.isArray(value)?value.map(ordered):value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered((value as Record<string,unknown>)[key])])):value
 return evidenceHash(JSON.stringify(ordered(projection)))
}

// Frozen from the exact current 5aef actual runtime result for this declared
// fixture. Key ordering is canonicalized; only rulePackEvidence is omitted.
// State/issues/reasons/source rules/trace/response and every other report field
// must retain the original NULL hold, rather than merely matching its code.
function expectCurrentNullSemantics(){
 const expected=variant==='L'?'3057dadc8842b80b1bbb07ea9b98e4ba38238bd0fbeea0b38300a9a18cb46799':'05c4a5662feab1f76bd108ab5ce7a0dc8047e282308d8e7a8cff2f4c5c1d5b07'
 expect(semanticDigest(io.actualDecision!),'original full semantic decision/report changed beyond witness').toBe(expected)
}
