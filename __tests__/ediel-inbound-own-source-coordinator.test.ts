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
 deliveredDecision:null as import('@/lib/ediel/core/runtimeDecision').CanonicalRuntimeDecision|null,ownSourceReadings:null as ProdatOwnSourceReadingSdk|null}))
vi.mock('@/lib/supabase/service',async()=>({supabaseService:(await import('./helpers/prodatOwnSourceReadingAdapter')).prodatOwnSourceReadingAdapter(()=>io.ownSourceReadings,{rpc:(name:string,args:Record<string,unknown>)=>sourceRpc(name,args),from:(table:string)=>tablePort(table)})}))
// The copy probe still executes the real validator first. It replaces only
// that actual return object's identity, never its national checks or facts.
vi.mock('@/lib/ediel/core/runtimeDecision',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/ediel/core/runtimeDecision')>()
 return {...actual,resolveCanonicalRuntimeDecisionWithRegistry:async(...args:Parameters<typeof actual.resolveCanonicalRuntimeDecisionWithRegistry>)=>{
  const result=await actual.resolveCanonicalRuntimeDecisionWithRegistry(...args);io.actualDecision=result
  return io.deliveredDecision=io.copyDecision?structuredClone(result):result
 }}
})
vi.mock('@/lib/ediel/tenant/resolveInboundTenant',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/lib/ediel/tenant/resolveInboundTenant')>()
 return {...actual,resolveInboundTenantFromIdentifiers:async(input:Record<string,unknown>)=>{
  io.trace.push('tenant-identifiers')
  if(io.message.message_family!=='PRODAT')return {status:'unresolved',companyId:null,evidence:[],candidateCompanyIds:[],reasons:['Declared no current tenant hint'],warnings:[]}
  expect(input.receiverEdielId).toBe('54321');expect(input.marketActorEdielId).toBe('54321')
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
 io.trace.push('persist-'+input.ackFamily);io.drafts.push(input.draft)
 return {id:'declared-ack-'+io.drafts.length,status:'draft',message_family:input.ackFamily} as EdielMessageRow
}}))
vi.mock('@/lib/ediel/outbox/createOutboxItem',()=>({createOutboxItem:async()=>({id:'declared-outbox'})}))
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
vi.mock('@/lib/onboarding/inboundEdielLinking',()=>({applyInboundProdatZ02ToCustomerInfoRequest:async()=>null,applyInboundProdatZ14ToMeteringPermission:async()=>null}))
vi.mock('@/lib/operations/db',()=>({createSupplierSwitchEvent:async()=>null}))
vi.mock('@/lib/ediel/flows/inboundBusinessStateMachine',()=>({applyInboundBusinessStateMachine:async()=>{throw Error('Unexpected legacy E business state machine')}}))

import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {hasReceivedCanonicalProdatPartialOwner} from '@/lib/ediel/core/runtimeDecision'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {deathSelection} from './fixtures/prodat-death-status'
import {raw,line,characteristic,common} from './fixtures/prodat-register'
import {head,source} from './fixtures/prodat-identity'
import {ownerSourceWithInstallationStatus as ownerSource} from './helpers/sourceOwnerFixtures'
import {createProdatOwnSourceReadingSdk,resetProdatOwnSourceReadingSdk,installProdatOwnSourceReadingFixture,type ProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'
import {finiteProdatRulePack} from './helpers/prodatOwnSourceReadingAdapter'
import type {SourceObjectScope} from '@/lib/ediel/sources/sourceOwnerWire'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,company=id(2),actor=id(50),pointA='735123456789012345',pointB='735123456789012346'
function registryEvidence(){
 const row=registryRow()
 return {rulePackId:row.rule_pack_id,messageProfileId:row.message_profile_id,sourceHash:row.source_hash,databaseProfileKey:row.profile_key,
  originalVersion:row.original_version,originalSnapshot:row.original_snapshot}
}
function registryRow(){
 if(io.message.message_code==='Z04')return finiteProdatRulePack('Z04','L','Z22')
 if(io.message.message_code==='Z14')return finiteProdatRulePack('Z14','N','Z96')
 if(io.message.message_code==='Z06')return finiteProdatRulePack('Z06','E','E34')
 throw Error('UNDECLARED_COORDINATOR_CATALOGUE_SCOPE')
}
function sourceRpc(name:string,args:Record<string,unknown>){
 io.calls.push({name,args});io.trace.push(name)
 const hash=(field:string)=>typeof args[field]==='string'?evidenceHash(args[field] as string):null
 let data:unknown=null,error:Error|null=null
 if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1'){io.trace.push('named-registry');const row=registryRow();expect(args).toMatchObject({p_market:'electricity',p_family:'PRODAT',p_message_code:row.profile.messageCode,p_transaction_subtype:row.profile.transactionSubtype,p_direction:'inbound'});data=[row]}
 else if(name==='ediel_read_technical_source_endpoint_v2')data=null
 else if(name==='gridex_read_committed_inbound_ack_v2'){
  expect(args.p_ack_payload_hash).toBe(evidenceHash(io.message.raw_payload!));data=io.retained
 }else if(name==='ediel_customer_life_event_inbound_basis_v1'){
  expect(args).toEqual({p_company_id:company,p_message_id:io.message.id,p_actor_user_id:actor})
  if(io.readFailure)error=Error('Declared protected life-event source read failure')
  else data={status:'authorized',companyId:company,environment:'test',messageId:io.message.id,rawPayload:io.message.raw_payload,
   sourceContextReceiptId:id(90),sourceContextFactsHash:'c'.repeat(64),sourcePayloadHash:evidenceHash(io.message.raw_payload!),classification:'death',bilateralCapabilityVerified:false,selection:ownDeathSelection()}
 }else if(name==='gridex_record_prodat_source_validation_v4'||name==='gridex_record_prodat_source_validation_v5'||name==='gridex_record_prodat_source_validation_v6'){
  io.append=structuredClone(args)
  data={version:name.endsWith('v6')?6:name.endsWith('v5')?5:4,companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,
   sourcePayloadHash:args.p_source_payload_hash,factsHash:hash('p_facts_text'),sourceDisposition:'not_established',assessmentId:id(77),
   objectFactsHash:hash('p_object_facts_text'),applicationFactsHash:hash('p_application_facts_text'),responseFactsHash:hash('p_response_facts_text'),ignoredFieldsHash:hash('p_ignored_fields_text'),
   ...((name.endsWith('v5')||name.endsWith('v6'))?{sourceFunctionFactsHash:hash('p_source_function_facts_text')}:{})}
 }else if(name==='ediel_probe_source_rule_pack_capture_v1'){
  expect(io.append).not.toBeNull();const r=registryEvidence(),p=r.databaseProfileKey
  data={status:'captured',evidence:{rulePackId:r.rulePackId,messageProfileId:r.messageProfileId,profileKey:p,version:r.originalVersion,sourceHash:r.sourceHash,
   snapshot:{profileKey:p,profileVersionId:r.messageProfileId,version:r.originalVersion,checksum:r.sourceHash,...r.originalSnapshot}}}
 }else if(name==='gridex_actor_has_company_permission')data=args.p_actor_user_id===actor&&args.p_company_id===company&&['communication.write','ediel_testing.write'].includes(String(args.p_permission))
 else if(name==='gridex_read_outbound_acks_for_source_v2')data={version:2,executionActorUserId:args.p_actor_user_id,executionPhase:args.p_phase,sourceMessageId:io.message.id,sourcePayloadHash:evidenceHash(io.message.raw_payload!),environment:'test',companyId:company,originals:[]}
 else if(name==='ediel_apply_customer_life_event_source_v1'){
  expect(args).toEqual({p_company_id:company,p_source_message_id:io.message.id,p_actor_user_id:actor})
  if(io.effectFailure)error=Error('Declared own life-event effect RPC failure')
  else data={applied:true,sourceMessageId:io.message.id,scopes:[{pointId:pointA,identityAgency:'9',customerId:id(3)}]}
 }else if(name==='ediel_customer_life_event_committed_source_v1'){
  expect(args).toEqual({p_company_id:company,p_message_id:io.message.id,p_actor_user_id:actor})
  data={version:1,sourceMessageId:io.message.id,sourcePayloadHash:evidenceHash(io.message.raw_payload!),companyId:company,environment:'test',rawPayload:io.message.raw_payload,
   scopes:[{pointId:pointA,identityAgency:'9',customerId:id(3),siteId:id(5),meteringPointId:id(4),classification:'death',effectiveAt:'2026-10-01T00:00:00+01:00'}],
   customerVersions:[{customerId:id(3),version:1}],observedAt:'2026-09-30T12:00:00Z',legalContext:{declaredSourceOwned:true}}
 }else if(name==='ediel_apply_supply_source_v1'||name==='ediel_apply_permission_source_v1'){
  expect(args).toEqual({p_company_id:company,p_source_message_id:io.message.id,p_actor_user_id:actor,
   ...(name==='ediel_apply_permission_source_v1'?{p_expected_permission_id:null}:{})})
  expect(io.append?.p_source_payload_hash).toBe(evidenceHash(io.message.raw_payload!))
  if(io.effectFailure)error=Error('Declared own domain effect failure')
  else data=io.domainResult
 }else if(name==='ediel_project_supply_end_followup_v1'){
  expect(args).toEqual({p_company_id:company,p_effect_receipt_id:id(91),p_actor_user_id:actor})
  if(io.followupFailure)error=Error('Declared followup projection failure')
  else data={status:'created',effectReceiptId:id(91),sourceMessageId:io.message.id,caseId:id(92)}
 }else if(name==='gridex_record_source_object_decisions_v1')data={version:1,companyId:args.p_company_id,environment:args.p_environment,sourceMessageId:args.p_source_message_id,
  sourcePayloadHash:args.p_source_payload_hash,canonicalAssessmentId:args.p_canonical_assessment_id,factsHash:hash('p_facts_text'),assessmentId:id(78)}
 else if(name==='gridex_witness_source_objects_v1')data={version:1,companyId:args.p_company_id,environment:args.p_environment,assessmentId:args.p_assessment_id,factsHash:args.p_facts_hash,witnessId:id(79),availableAt:new Date().toISOString()}
 else throw Error('UNEXPECTED_NATIVE_PORT:'+name)
 const promise=Promise.resolve({data,error});return Object.assign(promise,{abortSignal:()=>promise})
}
function tablePort(table:string){
 io.trace.push('table:'+table)
 const filters:((row:Record<string,unknown>)=>boolean)[]=[],rows=()=> (io.tables[table]??[]).filter(row=>filters.every(test=>test(row)))
 let values:Record<string,unknown>|undefined,inserted:Record<string,unknown>|undefined,columns='*'
 const result=(single=false)=>{
  let selected=rows();if(values){selected.forEach(row=>Object.assign(row,values));if(table==='ediel_messages')io.message=selected[0] as unknown as EdielMessageRow}
  if(inserted){const row={id:id(80),...inserted};(io.tables[table]??=[]).push(row);selected=[row];inserted=undefined}
  const data=selected.map(row=>columns==='*'?structuredClone(row):Object.fromEntries(columns.split(',').map(key=>[key,row[key]])))
  return {data:single?data[0]??null:data,error:null,count:data.length}
 }
 const q={select:(value='*')=>{columns=value;return q},eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return q},
  in:(key:string,value:unknown[])=>{filters.push(row=>value.includes(row[key]));return q},not:(key:string,_operator:string,value:unknown)=>{filters.push(row=>row[key]!==value);return q},
  limit:()=>q,abortSignal:()=>q,update:(value:Record<string,unknown>)=>{values=value;return q},insert:(value:Record<string,unknown>)=>{inserted=value;return q},
  maybeSingle:async()=>result(true),single:async()=>result(true),then:(resolve:(value:ReturnType<typeof result>)=>unknown)=>Promise.resolve(result()).then(resolve)}
 return q
}
function ownDeathSelection(){const selection=deathSelection(),own=selection.objects[0];own.installation={id:pointA,agency:'9'};own.customer={...own.customer,id:'CUSTOMER-1'};own.lineItemReference='CASE-1';own.legalGridOwner={id:'12345',qualifier:'160',agency:'SVK'};own.legalSupplier={id:'54321',qualifier:'160',agency:'SVK'};return selection}
function eventMessage(badSibling=false){
 const own=(point:string,sequence:string,status:string)=>{
  const original=common(sequence,'Declared customer').map(p=>p[0]==='DTM'&&Array.isArray(p[1])&&p[1][0]==='92'?['DTM',['157','202610010000','203']]:p[0]==='CAV'&&Array.isArray(p[1])&&p[1][0]==='Z22'?['CAV','E34']:p)
  return [line(sequence,point,undefined,'9'),...original.filter(p=>p[0]==='DTM'),...characteristic('Z17',status),...characteristic('Z12','D',3),
   ...original.filter(p=>p[0]!=='DTM'),['NAD','IT',[point,'','9'],'','','Street','City','','12345','SE'],['NAD','Z02',['11111','160','SVK']]]
 }
 const wire=raw([...head(),...own(pointA,'1','Z41'),...own(pointB,'2',badSibling?'BAD':'Z41')] as Parameters<typeof raw>[0],'Z06').replace('+S+R+','+12345:14+54321:14+')
 const message={...source(wire,'Z06'),company_id:company,status:'received',message_received_at:'2026-09-30T12:00:00.000000Z'} as EdielMessageRow
 message.execution_context_snapshot={receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:message.id,companyId:company,environment:'test',messageCode:'Z06',payloadHash:evidenceHash(wire),sourceReceivedAt:message.message_received_at,capturedAt:message.message_received_at}}
 return message
}
function receivedDomain(wire:string,code:string){
 const message={...source(wire,code),company_id:company,status:'received',application_reference:code==='Z14'?'23-DGI-PRODAT':'23-DDQ-PRODAT',
  // Declared receiver-local readings facts match the independent good supply
  // fixture. They are not an authentic source or native business approval.
  parsed_payload:code==='Z04'?ownerSource('Z12').parsed_payload:{}} as EdielMessageRow
 if(code==='Z04'){message.inbound_email_message_id=id(60);message.created_at=message.message_received_at!}
 message.execution_context_snapshot={receivedProdatContext:{version:1,contextOrigin:'database_insert',sourceMessageId:message.id,companyId:company,environment:'test',messageCode:code,payloadHash:evidenceHash(wire),sourceReceivedAt:message.message_received_at,capturedAt:message.message_received_at}}
 return message
}
function supplyMessage(){
 const first=tokenizeEdifact(ownerSource('Z12',{readingDeclarations:true,sourceCodes:{installationStatus:'Z12',settlementMethod:'Z32'}}).raw_payload!),start=first.segments.findIndex(token=>token.tag==='LIN'),end=first.segments.findIndex(token=>token.tag==='UNT')
 const own=first.segments.slice(start,end).map(token=>token.raw)
 const sibling=own.filter(segment=>!segment.startsWith('QTY+31')).map(segment=>segment.replace('LIN+1+','LIN+2+').replaceAll(pointA,pointB).replaceAll('CASE-1','CASE-2'))
 const all=[...first.segments.slice(0,start).map(token=>token.raw),...own,...sibling],unh=all.findIndex(segment=>segment.startsWith('UNH+'))
 return receivedDomain("UNA:+.? '"+all.join("'")+"'UNT+"+(all.length-unh+1)+"+M'UNZ+1+I'",'Z04')
}
function permissionMessage(badSibling=true){
 const scope=(n:string,bad:boolean)=>[['LIN',n],...characteristic('Z13','Z96'),...characteristic('Z23',bad?'BAD':'A76'),['RFF',['LI','REQUEST-'+n]]]
 const wire=raw([...head(),...scope('1',false),...scope('2',badSibling)] as Parameters<typeof raw>[0],'Z14')
   .replace('+S+R+','+12345:14+54321:14+').replace('23-DDQ-PRODAT','23-DGI-PRODAT')
 return receivedDomain(wire,'Z14')
}
function physicalScopes():SourceObjectScope[]{
 const wire=tokenizeEdifact(io.message.raw_payload!)
 return wire.segments.flatMap((token,segmentIndex)=>token.tag==='LIN'?[{messageIndex:0,messageReference:'M',
  objectId:io.message.message_code==='Z14'?null:segmentComposite(token,3,wire.una)[0],identityAgency:io.message.message_code==='Z14'?null:'9',
  registers:[{lineIndex:Number(segmentComposite(token,1,wire.una)[0])-1,segmentIndex,lineNumber:segmentComposite(token,1,wire.una)[0],registerIndex:null,registerPosition:1}]}]:[])
}
function supplyResult(applied=true){
 const scopes=physicalScopes()
 return {applied,idempotent:false,periods:[],commits:[],effectReceiptIds:applied?[id(91)]:[],partition:scopes.map((object,index)=>applied&&index===0
  ?{object,disposition:'applied',effectReceiptId:id(91),effectFactsHash:'d'.repeat(64)}:{object,disposition:'held',reason:'Declared absent own effect basis'})}
}
function permissionResult(allApplied=false){
 const scopes=physicalScopes()
 return {version:1,sourceMessageId:io.message.id,sourceCode:'Z14',sourcePayloadHash:evidenceHash(io.message.raw_payload!),canonicalAssessmentId:id(77),
  applied:true,permissionId:null,status:'declined',idempotent:false,manifest:scopes.map((object,index)=>index===0||allApplied
   ?{object,status:'applied',permissionId:id(93+index)}:{object,status:'rejected',reason:'Declared own national rejection'}),
  permissionResults:scopes.flatMap((_object,index)=>index===0||allApplied?[{permissionId:id(93+index),applied:true,status:'declined'}]:[])}
}
function ackMessage(tenant:string|null){const rawPayload=EdifactEnvelopeCodec.encode({sender:'54321',receiver:'12345',environment:'test',interchangeReference:'ACK-I',applicationReference:'23-DDQ-PRODAT',acknowledgementRequest:false,
 messages:[{messageReference:'ACK-M',messageTypeToken:'CONTRL:2:2:UN',businessSegments:['UCI+SOURCE-I+12345:14+54321:14+1']}]});return {...source(rawPayload),company_id:tenant,message_family:'CONTRL',message_code:'CONTRL',status:'received'} as EdielMessageRow}
function setMessage(message:EdielMessageRow){io.message=message;io.tables.ediel_messages=[message as unknown as Record<string,unknown>];io.ownSourceReadings=null
 if(message.message_code==='Z04'){io.ownSourceReadings=createProdatOwnSourceReadingSdk();resetProdatOwnSourceReadingSdk(io.ownSourceReadings)
  installProdatOwnSourceReadingFixture(io.ownSourceReadings,message,'L',{actorUserId:actor,receivedAt:message.message_received_at!,mailId:message.inbound_email_message_id!,parseId:id(61),receptionId:id(62),legalActorId:id(9)})}}
const run=()=>processInboundEdielMessage({actorUserId:actor,edielMessageId:io.message.id})
const native=(name:string)=>io.calls.filter(call=>call.name===name)
const aperak=()=>io.drafts.filter(draft=>draft.messageFamily==='APERAK')
const finalPositive=()=>aperak().filter(draft=>String(draft.rawPayload).includes('ERC+100'))
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-30T13:00:00Z'))
 io.calls=[];io.trace=[];io.events=[];io.drafts=[];io.updates=0;io.readFailure=false;io.effectFailure=false;io.copyDecision=false;io.domainResult=null;io.domainAckFailure=false;io.followupFailure=false;io.retained=null;io.append=null;io.actualDecision=null;io.deliveredDecision=null
 io.tables={user_profiles:[{id:actor,user_status:'active'}],company_memberships:[{company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:'2026-01-01T00:00:00Z'}]};setMessage(eventMessage())})
afterEach(()=>vi.useRealTimers())

it('fresh NULL-company ACK reaches the real source tenant resolver after protected receipt absence',async()=>{
 setMessage(ackMessage(null));await run()
 expect(native('gridex_read_committed_inbound_ack_v2')).toHaveLength(1);expect(native('gridex_read_committed_inbound_ack_v2')[0].args.p_company_id).toBeNull()
 expect(io.trace).toContain('tenant-identifiers');expect(io.trace).toContain('table:ediel_business_references')
 expect(io.trace.indexOf('gridex_read_committed_inbound_ack_v2')).toBeLessThan(io.trace.indexOf('tenant-identifiers'))
 expect(io.message.company_id).toBeNull();expect(io.message.tenant_resolution_status).toBe('tenant_not_found');expect(io.trace).not.toContain('named-registry');expect(io.drafts).toEqual([])
})
it('retained own partial ACK returns before new tenant, registry or public status interpretation',async()=>{
 setMessage({...ackMessage(null),status:'failed',parsed_payload:{ackOutcome:'negative',ackScope:'message'},validation_report:{canonicalRuntime:{rulePackEvidence:{version:'untrusted-current-hint'}}}} as EdielMessageRow)
 const original={id:id(66),company_id:company,environment:'test',direction:'outbound'}
 io.retained={kind:'exact_receipt',ackMessageId:io.message.id,ackFamily:'CONTRL',companyId:company,environment:'test',ackPayloadHash:evidenceHash(io.message.raw_payload!),sourceMessageId:original.id,
  result:{version:1,sourceMessage:original,outcome:'positive',scope:'interchange',scopeOutcomes:[{reference:'SOURCE-I',outcome:'positive'}],finalAckReached:false,wholeSourceRejected:false,sourceAccepted:false,failureReason:null,idempotent:false}}
 const before=structuredClone(io.message);expect(await run()).toEqual(before)
 expect(native('gridex_read_committed_inbound_ack_v2')[0].args.p_company_id).toBeNull()
 expect(io.trace).toEqual(['gridex_read_committed_inbound_ack_v2']);expect(io.updates).toBe(0);expect(io.drafts).toEqual([])
})
it('protected E source-read failure preserves own national negative while withholding final positive and effects',async()=>{
 setMessage(eventMessage(true));io.readFailure=true;await run()
 expect(io.actualDecision?.syntaxDecision).toBe('accepted')
 const errors=io.actualDecision?.responsePlan.flatMap(plan=>plan.applicationErrors??[])
 expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ercCode:'42',fieldCode:'310',referenceNumber:pointB})]))
 expect(aperak()).toEqual([]);expect(finalPositive()).toEqual([]);expect(native('ediel_apply_customer_life_event_source_v1')).toEqual([])
 expect(io.message.validation_report).toMatchObject({customerLifeEventSourceIncident:{kind:'source_read_unavailable',authorizesBusinessEffects:false}})
})
it('a failing E effect retains its own national error without inventing a final outcome for an untouched sibling',async()=>{
 setMessage(eventMessage(true));io.effectFailure=true;await run()
 expect(native('ediel_apply_customer_life_event_source_v1')).toHaveLength(1)
 const errors=io.actualDecision?.responsePlan.flatMap(plan=>plan.applicationErrors??[])
 expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ercCode:'42',fieldCode:'310',referenceNumber:pointB})]))
 expect(aperak()).toEqual([]);expect(finalPositive()).toEqual([])
 expect(io.events.some(event=> (event.payload as {customerLifeEventEffect?:string;authorizesBusinessEffects?:boolean})?.customerLifeEventEffect==='held'&&(event.payload as {authorizesBusinessEffects?:boolean}).authorizesBusinessEffects===false)).toBe(true)
})
it('same-invocation full APP and own function-good scope reaches its native effect while an unknown sibling stays held',async()=>{
 const original=eventMessage();setMessage(original);await run()
 expect(io.actualDecision?.applicationDecision).toBe('accepted');expect(io.actualDecision?.prodatProcessingDisposition?.kind).toBe('internal_review')
 expect(hasReceivedCanonicalProdatPartialOwner(io.actualDecision!,original)).toBe(true)
 expect(native('ediel_apply_customer_life_event_source_v1')).toHaveLength(1)
 const functions=JSON.parse(String(io.append?.p_source_function_facts_text));expect(functions.objects.map((object:{objectId:string;functionalDecision:string})=>[object.objectId,object.functionalDecision])).toEqual([[pointA,'accepted'],[pointB,'held']])
 const objectFacts=JSON.parse(String(native('gridex_record_source_object_decisions_v1')[0].args.p_facts_text))
 expect(objectFacts.objects.map((entry:{object:{objectId:string};disposition:string})=>[entry.object.objectId,entry.disposition])).toEqual([[pointA,'accepted'],[pointB,'unavailable']])
 expect(io.trace).toContain('source-bound-case');expect(finalPositive()).toEqual([])
})
it('JSON copy of the actual partial decision cannot continue an own effect or mint opaque own facets',async()=>{
 const original=eventMessage();setMessage(original);io.copyDecision=true
 await run()
 expect(hasReceivedCanonicalProdatPartialOwner(io.actualDecision!,original)).toBe(true)
 expect(hasReceivedCanonicalProdatPartialOwner(io.deliveredDecision!,original)).toBe(false)
 expect(native('ediel_apply_customer_life_event_source_v1')).toEqual([])
 expect(native('gridex_record_prodat_source_validation_v5')).toEqual([])
 expect(io.append?.p_application_facts_text).toBeNull();expect(io.append?.p_response_facts_text).toBeNull()
 const refusedObjects=JSON.parse(String(native('gridex_record_source_object_decisions_v1')[0].args.p_facts_text))
 expect(refusedObjects.objects.map((entry:{disposition:string;reasons:string[]})=>[entry.disposition,entry.reasons])).toEqual([
  ['unavailable',['source_owner_not_established']],['unavailable',['source_owner_not_established']]])
 // Syntax acceptance remains independent from an unavailable business owner.
 expect(aperak()).toEqual([]);expect(io.drafts.every(draft=>draft.messageFamily==='CONTRL')).toBe(true)
 expect(io.message.validation_report).toMatchObject({prodatProcessingDisposition:{kind:'internal_review'}})
})

it('complete mixed supply source reaches one native owner before committed ACKs and never the first-target legacy writer',async()=>{
 setMessage(supplyMessage());const original=io.message.raw_payload;io.domainResult=supplyResult();await run()
 expect(io.actualDecision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'accepted'})
 expect(native('ediel_apply_supply_source_v1')).toHaveLength(1);expect(io.message.raw_payload).toBe(original)
 expect(io.trace.indexOf('ediel_apply_supply_source_v1')).toBeLessThan(io.trace.indexOf('committed-domain-ack'));expect(aperak()).toEqual([])
 expect(io.trace.indexOf('ediel_project_supply_end_followup_v1')).toBeLessThan(io.trace.indexOf('committed-domain-ack'))
 expect(native('ediel_project_supply_end_followup_v1')).toHaveLength(1)
 expect(io.trace.filter(step=>step==='committed-domain-ack')).toHaveLength(1)
 expect(io.events).toEqual(expect.arrayContaining([expect.objectContaining({payload:expect.objectContaining({applied:true,fullyApplied:false,reviewRequired:true,committedEffectReceiptIds:[id(91)]})})]))
})
it('source-qualified N decline without object identity reaches its own parent, preserves rejected sibling and does not grant a permission',async()=>{
 setMessage(permissionMessage());io.domainResult=permissionResult();await run()
 expect(io.actualDecision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'rejected',functionalDecision:'accepted'})
 expect(native('ediel_apply_permission_source_v1')).toHaveLength(1);expect(native('ediel_apply_supply_source_v1')).toHaveLength(0)
 expect(io.trace.indexOf('ediel_apply_permission_source_v1')).toBeLessThan(io.trace.indexOf('committed-domain-ack'));expect(aperak()).toEqual([])
 expect(io.trace.indexOf('ediel_apply_permission_source_v1')).toBeLessThan(io.trace.indexOf('committed-domain-ack'))
 expect(io.events).toEqual(expect.arrayContaining([expect.objectContaining({payload:expect.objectContaining({fullyApplied:false,reviewRequired:true,
  permissionResults:[{permissionId:id(93),applied:true,status:'declined'}],sourceObjectPartition:expect.arrayContaining([expect.objectContaining({object:expect.objectContaining({objectId:null}),status:'rejected'})])})})]))
})
it('all processed N parents can receive final response without choosing a first parent or requiring a point',async()=>{
 setMessage(permissionMessage(false));io.domainResult=permissionResult(true);await run()
 expect(io.actualDecision?.applicationDecision).toBe('accepted');expect(native('ediel_apply_permission_source_v1')).toHaveLength(1)
 expect(io.trace.filter(step=>step==='committed-domain-ack')).toHaveLength(1)
 expect(io.events).toEqual(expect.arrayContaining([expect.objectContaining({payload:expect.objectContaining({fullyApplied:true,reviewRequired:false,permissionResults:expect.arrayContaining([
  {permissionId:id(93),applied:true,status:'declined'},{permissionId:id(94),applied:true,status:'declined'}])})})]))
})
it.each(['Z04','Z14'])('JSON copies cannot continue a domain owner for %s',async code=>{
 setMessage(code==='Z04'?supplyMessage():permissionMessage());io.copyDecision=true;await run()
 expect(native('ediel_apply_supply_source_v1')).toHaveLength(0);expect(native('ediel_apply_permission_source_v1')).toHaveLength(0)
 expect(io.trace).not.toContain('committed-domain-ack')
})
it('no native supply effect means no positive own receipt projection',async()=>{
 setMessage(supplyMessage());io.domainResult=supplyResult(false);await run()
 expect(native('ediel_apply_supply_source_v1')).toHaveLength(1);expect(io.trace).not.toContain('committed-domain-ack')
 expect(native('ediel_project_supply_end_followup_v1')).toHaveLength(0)
})
it.each(['supply','permission'])('malformed native %s partition cannot reach final ACK projection',async family=>{
 setMessage(family==='supply'?supplyMessage():permissionMessage());io.domainResult=family==='supply'?supplyResult():permissionResult()
 if(family==='supply')io.domainResult.effectReceiptIds=[id(99)]
 else io.domainResult.canonicalAssessmentId='copied-public-hint'
 await expect(run()).rejects.toThrow(family==='supply'?'supply_object_partition_effect_mismatch':'permission_native_partition_invalid')
 expect(io.trace).not.toContain('committed-domain-ack');expect(aperak()).toEqual([])
})
it('operational followup failure preserves established effects and still projects own committed ACKs',async()=>{
 setMessage(supplyMessage());io.domainResult=supplyResult();io.followupFailure=true;await run()
 expect(io.trace).toContain('committed-domain-ack')
 expect(io.events).toEqual(expect.arrayContaining([expect.objectContaining({payload:expect.objectContaining({supplyEndFollowup:'held',effectReceiptId:id(91)})})]))
})
it('committed ACK projection failure records a hold without changing an applied permission outcome',async()=>{
 setMessage(permissionMessage());io.domainResult=permissionResult();io.domainAckFailure=true;await run()
 expect(io.events).toEqual(expect.arrayContaining([expect.objectContaining({payload:expect.objectContaining({blockedBy:'canonical_inbound_ack_guard',ackFamily:'APERAK'})}),
  expect.objectContaining({payload:expect.objectContaining({applied:true,reviewRequired:true})})]))
})
it('an immutable native replay repeats the same own receipt paths and keeps the rejected sibling held',async()=>{
 setMessage(supplyMessage());io.domainResult={...supplyResult(),idempotent:true};await run();await run()
 expect(native('ediel_apply_supply_source_v1')).toHaveLength(2);expect(native('ediel_project_supply_end_followup_v1')).toHaveLength(2)
 expect(io.events).toEqual(expect.arrayContaining([expect.objectContaining({payload:expect.objectContaining({idempotent:true,fullyApplied:false,committedEffectReceiptIds:[id(91)]})})]))
})

// National final responses cannot precede qualification of the actual primary
// effect partition. Technical syntax CONTRL remains independent.
it.each(['supply','permission'])('native %s failure preserves source and emits no premature final APERAK',async family=>{
 setMessage(family==='supply'?supplyMessage():permissionMessage());const original=io.message.raw_payload;io.effectFailure=true
 await expect(run()).rejects.toThrow('Declared own domain effect failure')
 expect(io.message.raw_payload).toBe(original);expect(aperak()).toEqual([])
 expect(io.trace).not.toContain('committed-domain-ack')
})
