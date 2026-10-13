// AT-Z04C-SUPPLIER finite consumer support only; no whole-ID tag/approval.
// Actual coordinator, canonical wire/owners, case parser/CAS and event writer.
// Lower SQL, catalogue/provenance SDK and tables are declared modeled ports:
// no PostgreSQL durability, native authority, compensation completion or
// cancellation-first/later-original execution is claimed by this component.
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {ProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'
type Row=Record<string,unknown>
type Filter={name:string;args:unknown[]}
const io=vi.hoisted(()=>({tables:{} as Record<string,Row[]>,calls:[] as {name:string;args:Row}[],
 queries:[] as {table:string;operation:string;filters:Filter[];payload?:Row}[],trace:[] as string[],
 readings:null as ProdatOwnSourceReadingSdk|null,append:null as Row|null,
 caseRace:null as ((row:Row)=>void)|null,brokenCaseTenant:false,eventError:null as unknown,
 ack:vi.fn(),workflow:vi.fn(),activation:vi.fn()}))
vi.mock('@/lib/supabase/service',async()=>({supabaseService:(await import('./helpers/prodatOwnSourceReadingAdapter')).prodatOwnSourceReadingAdapter(()=>io.readings,{from:tablePort,rpc:sourceRpc})}))
// Declared tenant lookup port only. The coordinator's tenant/source handling,
// immutable-original SDK reader and canonical runtime still execute.
vi.mock('@/lib/ediel/tenant/resolveInboundTenant',async importOriginal=>({
 ...await importOriginal<typeof import('@/lib/ediel/tenant/resolveInboundTenant')>(),
 resolveInboundTenantFromIdentifiers:async(input:Row)=>{
  expect(input.receiverEdielId).toBe('54321');expect(input.marketActorEdielId).toBe('54321')
  return {status:'resolved',companyId:company,evidence:[{companyId:company,source:'verified_legal_identity',score:300,details:{modeled:true}}],candidateCompanyIds:[company],reasons:[],warnings:[]}
 }}))
vi.mock('@/lib/ediel/core/kernel',()=>({createCanonicalAckMessage:(...args:unknown[])=>io.ack(...args)}))
vi.mock('@/lib/ediel/flows/receivedProdatStructuralAcks',()=>({createReceivedProdatCommittedEffectAcks:(...args:unknown[])=>io.ack(...args)}))
vi.mock('@/lib/ediel/outbox/createOutboxItem',()=>({createOutboxItem:(...args:unknown[])=>io.ack(...args)}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:async()=>null}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline',()=>({analyzeEdielProcessingPipeline:async()=>null}))
vi.mock('@/lib/inbound-mail/edielMailboxPoller',()=>({runInboundEdielMailEngine:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:(...args:unknown[])=>io.workflow(...args)}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:(...args:unknown[])=>io.activation(...args)}))
vi.mock('@/lib/ediel/matching',()=>({matchMeteringPointForEdielMessage:()=>{throw Error('unexpected_legacy_matching')},matchSiteAndCustomerForMeteringPoint:()=>{throw Error('unexpected_legacy_matching')},findMatchingSupplierSwitchRequest:()=>{throw Error('unexpected_legacy_matching')}}))

import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {createOrUpdateInboundProdatCase} from '@/lib/ediel/inboundCases'
import {ownerSourceWithInstallationStatus,ownerRows,ownerId} from './helpers/sourceOwnerFixtures'
import {finiteProdatRulePack} from './helpers/prodatOwnSourceReadingAdapter'
import {createProdatOwnSourceReadingSdk,installProdatOwnSourceReadingFixture,resetProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
const company=ownerId(2),actor=ownerId(50),sourceId=ownerId(1),point='735123456789012345',caseId=ownerId(80)
const cause='z04c_effect_already_executed_compensation_required'
const catalogue=()=>finiteProdatRulePack('Z04','C','Z24')
function original(){return io.tables.ediel_messages.find(row=>row.id===sourceId)! as unknown as EdielMessageRow}
function physicalScope(){
 const wire=tokenizeEdifact(original().raw_payload!),lin=wire.segments.find(token=>token.tag==='LIN')!
 return {messageIndex:0,messageReference:segmentComposite(wire.segments.find(token=>token.tag==='UNH')!,1,wire.una)[0],
  objectId:segmentComposite(lin,3,wire.una)[0],identityAgency:'9',registers:[{lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1,segmentIndex:lin.index}]}
}
function sourceRpc(name:string,args:Row){
 io.calls.push({name,args:structuredClone(args)});io.trace.push(name)
 const hash=(field:string)=>typeof args[field]==='string'?evidenceHash(args[field] as string):null
 let data:unknown=null
 if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){
  expect(args).toMatchObject({p_market:'electricity',p_family:'PRODAT',p_message_code:'Z04',p_transaction_subtype:'C',p_direction:'inbound'})
  data=[catalogue()]
 }else if(name==='gridex_actor_has_company_permission')data=args.p_company_id===company&&args.p_actor_user_id===actor&&['communication.write','ediel_testing.write'].includes(String(args.p_permission))
 else if(name==='ediel_read_technical_source_endpoint_v2')data=null
 else if(name==='gridex_record_prodat_source_validation_v6'){
  io.append=structuredClone(args)
  data={version:6,companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,sourcePayloadHash:args.p_source_payload_hash,
   factsHash:hash('p_facts_text'),sourceDisposition:'not_established',assessmentId:ownerId(77),objectFactsHash:hash('p_object_facts_text'),
   applicationFactsHash:hash('p_application_facts_text'),responseFactsHash:hash('p_response_facts_text'),ignoredFieldsHash:hash('p_ignored_fields_text'),sourceFunctionFactsHash:hash('p_source_function_facts_text')}
 }else if(name==='ediel_probe_source_rule_pack_capture_v1'){
  expect(io.append?.p_source_payload_hash).toBe(evidenceHash(original().raw_payload!))
  const r=catalogue();data={status:'captured',evidence:{rulePackId:r.rule_pack_id,messageProfileId:r.message_profile_id,profileKey:r.profile_key,version:r.original_version,sourceHash:r.source_hash,
   snapshot:{...r.original_snapshot,profileKey:r.profile_key,profileVersionId:r.message_profile_id,version:r.original_version,checksum:r.source_hash}}}
 }else if(name==='gridex_read_outbound_acks_for_source_v2')data={version:2,executionActorUserId:args.p_actor_user_id,executionPhase:args.p_phase,sourceMessageId:sourceId,sourcePayloadHash:evidenceHash(original().raw_payload!),environment:'test',companyId:company,originals:[]}
 else if(name==='ediel_apply_supply_source_v1'){
  expect(args).toEqual({p_company_id:company,p_source_message_id:sourceId,p_actor_user_id:actor})
  expect(io.append?.p_source_payload_hash).toBe(evidenceHash(original().raw_payload!))
  expect(JSON.parse(String(io.append?.p_facts_text))).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'})
  const application=JSON.parse(String(io.append?.p_application_facts_text))
  expect(application).toMatchObject({headerDecision:'accepted',objects:[{objectId:point,applicationDecision:'accepted'}]})
  // Exact modeled lower-owner refusal. It performs no business table write.
  data={applied:false,reason:cause,idempotent:false,periods:[],commits:[],effectReceiptIds:[],partition:[{object:physicalScope(),disposition:'held',reason:cause}]}
 }else if(name==='gridex_record_source_object_decisions_v1')data={version:1,companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,
  sourcePayloadHash:args.p_source_payload_hash,canonicalAssessmentId:args.p_canonical_assessment_id,factsHash:hash('p_facts_text'),assessmentId:ownerId(78)}
 else if(name==='gridex_witness_source_objects_v1')data={version:1,companyId:args.p_company_id,environment:args.p_environment,assessmentId:args.p_assessment_id,factsHash:args.p_facts_hash,witnessId:ownerId(79),availableAt:new Date().toISOString()}
 else throw Error('undeclared_finite_rpc:'+name)
 const result=Promise.resolve({data,error:null});return Object.assign(result,{abortSignal:()=>result})
}
// Finite query store: the actual production case/event writers supply payloads
// and filters. The store applies filters/CAS, never invents a desired case result.
function tablePort(table:string){
 if(!Object.hasOwn(io.tables,table))throw Error('undeclared_finite_table:'+table)
 const filters:Filter[]=[],tests:((row:Row)=>boolean)[]=[]
 let payload:Row|undefined,operation='select',columns='*',limit=Infinity
 const result=(single:boolean)=>{
  io.queries.push({table,operation,filters:structuredClone(filters),...(payload?{payload:structuredClone(payload)}:{})})
  let selected=io.tables[table].filter(row=>tests.every(test=>test(row))).slice(0,limit)
  if(operation==='update'&&table==='ediel_inbound_cases'&&io.caseRace&&selected[0]){
   const race=io.caseRace;io.caseRace=null;race(selected[0]);selected=io.tables[table].filter(row=>tests.every(test=>test(row))).slice(0,limit)
  }
  if(operation==='insert'){
   if(table==='ediel_message_events'&&io.eventError)return {data:null,error:io.eventError}
   if(!['ediel_inbound_cases','ediel_message_events'].includes(table))throw Error('forbidden_finite_insert:'+table)
   const row={id:table==='ediel_inbound_cases'?caseId:ownerId(100+io.tables[table].length),created_at:'2026-10-13T15:30:00Z',updated_at:'2026-10-13T15:30:00Z',...payload}
   io.tables[table].push(row);selected=[row];io.trace.push('stored:'+table)
  }else if(operation==='update'){
   if(!['ediel_messages','ediel_inbound_cases'].includes(table))throw Error('forbidden_finite_update:'+table)
   if(table==='ediel_messages'&&Object.keys(payload!).some(key=>['raw_payload','company_id','environment','direction','customer_id','metering_point_id'].includes(key)&&selected.some(row=>row[key]!==payload![key])))throw Error('immutable_finite_source_write')
   selected.forEach(row=>Object.assign(row,payload));io.trace.push('updated:'+table)
  }
  if(table==='ediel_inbound_cases'&&operation==='select'&&io.brokenCaseTenant&&selected[0])selected=[{...selected[0],company_id:ownerId(90)}]
  const data=selected.map(row=>columns==='*'?structuredClone(row):Object.fromEntries(columns.split(',').map(key=>[key,row[key]])))
  return {data:single?data[0]??null:data,error:null,count:data.length}
 }
 const q={select:(value='*')=>{columns=value;return q},eq:(key:string,value:unknown)=>{filters.push({name:'eq',args:[key,value]});tests.push(row=>row[key]===value);return q},
  is:(key:string,value:unknown)=>{filters.push({name:'is',args:[key,value]});tests.push(row=>row[key]===value);return q},
  in:(key:string,values:unknown[])=>{filters.push({name:'in',args:[key,values]});tests.push(row=>values.includes(row[key]));return q},
  not:(key:string,_operator:string,value:unknown)=>{tests.push(row=>row[key]!==value);return q},
  or:(expression:string)=>{filters.push({name:'or',args:[expression]});const pairs=[...expression.matchAll(/([a-z_]+)\.eq\.("[^"]*"|[^,)]+)/g)].map(match=>[match[1],match[2].replace(/^"|"$/g,'')]);if(!pairs.length)throw Error('undeclared_finite_or');tests.push(row=>pairs.some(([key,value])=>row[key]===value));return q},
  limit:(value:number)=>{limit=value;return q},order:()=>q,abortSignal:()=>q,
  update:(value:Row)=>{payload=structuredClone(value);operation='update';return q},insert:(value:Row)=>{payload=structuredClone(value);operation='insert';return q},
  maybeSingle:async()=>result(true),single:async()=>result(true),then:(resolve:(value:ReturnType<typeof result>)=>unknown)=>Promise.resolve(result(false)).then(resolve)}
 return q
}
function graph(){return structuredClone(Object.fromEntries(['customers','customer_sites','metering_points','supplier_switch_requests','customer_supply_periods','customer_application_workflows'].map(table=>[table,io.tables[table]])))}
function sourceIdentity(){const m=original();return {id:m.id,company:m.company_id,environment:m.environment,direction:m.direction,raw:m.raw_payload,hash:evidenceHash(m.raw_payload!)}}
const run=()=>processInboundEdielMessage({actorUserId:actor,edielMessageId:sourceId})
function warning(){return io.tables.ediel_message_events.filter(event=>event.event_type==='validated'&&(event.event_payload as Row)?.reviewRequired===true)}
function expectHeldReview(before:ReturnType<typeof graph>,identity:ReturnType<typeof sourceIdentity>){
 expect(graph()).toEqual(before);expect(sourceIdentity()).toEqual(identity)
 expect(io.ack).not.toHaveBeenCalled();expect(io.activation).not.toHaveBeenCalled();expect(io.workflow).not.toHaveBeenCalled()
 expect(io.calls.filter(call=>call.name==='ediel_apply_supply_source_v1')).toHaveLength(1)
 expect(warning()).toHaveLength(1)
 expect(warning()[0]).toMatchObject({company_id:company,ediel_message_id:sourceId,message_id:sourceId,event_status:'warning',created_by:actor,
  event_payload:{inboundCaseId:caseId,reviewRequired:true,fullyApplied:false,applied:false,idempotent:false,committedEffectReceiptIds:[],sourceObjectPartition:[{object:physicalScope(),disposition:'held',reason:cause}]}})
 expect(warning()[0].payload).toEqual(warning()[0].event_payload)
 expect(io.trace.indexOf('ediel_apply_supply_source_v1')).toBeLessThan(io.trace.indexOf('stored:ediel_inbound_cases'))
 const inserts=io.queries.filter(query=>query.operation==='insert')
 expect(inserts.every(query=>['ediel_inbound_cases','ediel_message_events'].includes(query.table))).toBe(true)
}
beforeEach(()=>{
 vi.clearAllMocks();io.calls=[];io.queries=[];io.trace=[];io.append=null;io.caseRace=null;io.brokenCaseTenant=false;io.eventError=null
 io.ack.mockImplementation(()=>{throw Error('unexpected_final_ack')});io.activation.mockImplementation(()=>{throw Error('unexpected_activation')});io.workflow.mockImplementation(()=>{throw Error('missing_or_terminal_workflow_must_not_be_used')})
 const m=ownerSourceWithInstallationStatus('Z12',{readingDeclarations:true,sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}})
 m.raw_payload=m.raw_payload!.replace('CAV+Z22','CAV+Z24').replace('CUSTOMER-1::89','199001011234:SE2:260')
 // C's source-owned FALSE readings condition is effective from Handbok26B,
 // 2026-10-01. Define this synthetic reception BEFORE its immutable SDK birth.
 m.message_received_at='2026-10-13T12:00:00.000000Z';m.created_at=m.message_received_at
 m.execution_context_snapshot={receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:sourceId,companyId:company,environment:'test',messageCode:'Z04',payloadHash:evidenceHash(m.raw_payload),sourceReceivedAt:m.message_received_at,capturedAt:m.message_received_at}}
 m.parsed_payload={subtype:'L',start_date:'1900-01-01',customerId:ownerId(90),meterPointId:'FOREIGN-CACHED',original_message_id:ownerId(91)}
 io.tables={...ownerRows(),ediel_messages:[m as unknown as Row],ediel_inbound_cases:[],ediel_message_events:[],
  customers:[{id:ownerId(3),company_id:company,personal_number:'199001011234'}],customer_application_workflows:[],
  customer_supply_periods:[{id:ownerId(8),company_id:company,customer_id:ownerId(3),metering_point_id:ownerId(4),status:'active',source_message_id:ownerId(20),market_state_version:7},
   {id:ownerId(98),company_id:ownerId(90),customer_id:ownerId(93),metering_point_id:ownerId(94),status:'active',market_state_version:9}],
  supplier_switch_requests:[{id:ownerId(7),company_id:company,customer_id:ownerId(3),metering_point_id:ownerId(4),status:'completed',outbound_z03_message_id:ownerId(21)}]}
 io.readings=createProdatOwnSourceReadingSdk();resetProdatOwnSourceReadingSdk(io.readings)
 installProdatOwnSourceReadingFixture(io.readings,m,'C',{actorUserId:actor,receivedAt:m.message_received_at!,mailId:m.inbound_email_message_id!,parseId:ownerId(61),receptionId:ownerId(62),legalActorId:ownerId(9)})
})
it.each(['missing','terminal'])('real C/Z24 caller stores precise compensation review even with %s application workflow',async mode=>{
 if(mode==='terminal')io.tables.customer_application_workflows=[{id:ownerId(30),company_id:company,customer_id:ownerId(3),state:'completed',next_action:'none'}]
 const before=graph(),identity=sourceIdentity();await run();expectHeldReview(before,identity)
 const saved=io.tables.ediel_inbound_cases[0]
 expect(saved).toMatchObject({id:caseId,company_id:company,ediel_message_id:sourceId,message_code:'Z04',transaction_type:'Z24',status:'pending_review',created_by:actor,updated_by:actor,
  customer_id:ownerId(3),site_id:ownerId(5),metering_point_id:ownerId(4),parsed_customer:{personalNumber:'199001011234'},parsed_metering_point:{meterPointId:point,identityAgency:'9'},parsed_contract:{startDate:'202610010000',agreementReference:null},proposed_action:{action:'pending_admin_review',objectCount:1}})
 const scopes=(saved.proposed_action as {objects:{meteringPointId:string;registers:{lineItemReference:string}[]}[]}).objects
 expect(scopes[0].meteringPointId).toBe(point);expect(scopes[0].registers[0].lineItemReference).toBe('CASE-1')
 // The review is an operator handoff, never proof of operator execution.
 const first=structuredClone(saved);await run()
 expect(io.tables.ediel_inbound_cases).toHaveLength(1);expect(io.tables.ediel_inbound_cases[0]).toEqual(first)
 expect(warning()).toHaveLength(2);expect(graph()).toEqual(before);expect(sourceIdentity()).toEqual(identity);expect(io.ack).not.toHaveBeenCalled()
 const updates=io.queries.filter(query=>query.table==='ediel_inbound_cases'&&query.operation==='update')
 expect(updates).toHaveLength(1);expect(updates[0].filters).toEqual(expect.arrayContaining([{name:'eq',args:['id',caseId]},{name:'eq',args:['company_id',company]},{name:'eq',args:['status','pending_review']},{name:'eq',args:['updated_at',first.updated_at]}]))
})
it.each(['applied','approved','rejected','objectApplication'])('coordinator retains existing %s review instead of reopening it',async state=>{
 await run();const saved=io.tables.ediel_inbound_cases[0]
 Object.assign(saved,{status:state==='objectApplication'?'pending_review':state,review_decision:state==='objectApplication'?{objectApplication:{lineIndices:[physicalScope().registers[0].segmentIndex],retained:true}}:{retained:'manual'},reviewed_by:ownerId(55),reviewed_at:'2026-10-12T12:00:00Z'})
 const retained=structuredClone(saved),before=graph();io.queries=[];await run()
 expect(io.tables.ediel_inbound_cases).toEqual([retained]);expect(graph()).toEqual(before)
 expect(io.queries.filter(query=>query.table==='ediel_inbound_cases'&&query.operation!=='select')).toEqual([])
 expect(warning().at(-1)).toMatchObject({event_payload:{inboundCaseId:caseId,sourceObjectPartition:[{disposition:'held',reason:cause}]}});expect(io.ack).not.toHaveBeenCalled()
})
it('lost pending-case CAS retains a newly finalized operator decision through the actual reread',async()=>{
 await run();io.queries=[];io.caseRace=row=>Object.assign(row,{status:'approved',updated_at:'2026-10-13T15:31:00Z',review_decision:{operatorStart:'declared_manual_decision'}})
 await run();expect(io.tables.ediel_inbound_cases[0]).toMatchObject({status:'approved',review_decision:{operatorStart:'declared_manual_decision'}})
 const cas=io.queries.find(query=>query.table==='ediel_inbound_cases'&&query.operation==='update')!
 expect(cas.filters).toEqual(expect.arrayContaining([{name:'eq',args:['id',caseId]},{name:'eq',args:['company_id',company]},{name:'eq',args:['status','pending_review']}]))
 expect(io.queries).toContainEqual(expect.objectContaining({table:'ediel_inbound_cases',operation:'select',filters:expect.arrayContaining([{name:'eq',args:['id',caseId]},{name:'eq',args:['ediel_message_id',sourceId]},{name:'eq',args:['company_id',company]}])}))
 expect(warning().at(-1)).toMatchObject({event_payload:{inboundCaseId:caseId,applied:false}});expect(io.ack).not.toHaveBeenCalled()
})
it('lost CAS with changed undecided payload refuses instead of overwriting the competing review',async()=>{
 await run();const firstWarning=warning().length
 io.caseRace=row=>Object.assign(row,{updated_at:'2026-10-13T15:31:00Z',parsed_customer:{manualChange:'retain'}})
 await expect(run()).rejects.toThrow('PRODAT_INBOUND_CASE_CHANGED')
 expect(io.tables.ediel_inbound_cases[0].parsed_customer).toEqual({manualChange:'retain'});expect(warning()).toHaveLength(firstWarning);expect(io.ack).not.toHaveBeenCalled()
})
it('a foreign case returned by a broken finite read port is refused before any case update',async()=>{
 await run();const retained=structuredClone(io.tables.ediel_inbound_cases);io.queries=[];io.brokenCaseTenant=true
 await expect(run()).rejects.toThrow('TENANT_CONTEXT_MISMATCH')
 expect(io.tables.ediel_inbound_cases).toEqual(retained);expect(io.queries.filter(query=>query.table==='ediel_inbound_cases'&&query.operation==='update')).toEqual([]);expect(io.ack).not.toHaveBeenCalled()
})
it('real case writer propagates a warning storage failure without claiming an operator start',async()=>{
 const error={code:'42501',message:'declared warning storage denied'};io.eventError=error
 await expect(createOrUpdateInboundProdatCase({actorUserId:actor,message:original()})).rejects.toBe(error)
 // The case INSERT occurred before the real event write; no transaction-wide
 // rollback or durable warning is invented by this finite storage model.
 expect(io.tables.ediel_inbound_cases).toHaveLength(1);expect(warning()).toEqual([]);expect(io.ack).not.toHaveBeenCalled()
})
