// Cooperative producer regression, not acceptance of the foreign A/D contracts.
// Actual syntax, canonical runtime, actor/tenant resolution and public receiver
// execute. Database transport is explicitly finite. The canonical writer refuses
// persistence and the status port stops execution: no accepted ledger, business
// capability, native prepare receipt, ACK or real database authority is fabricated.
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {ownerId,ownerRows,ownerSource} from './helpers/sourceOwnerFixtures'
import {withProdatFixtureInsertContext} from './helpers/prodatInboundSourceFixture'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'

type Row=Record<string,unknown>
const io=vi.hoisted(()=>({source:{} as EdielMessageRow,rows:{} as Record<string,Row[]>,
 calls:[] as {name:string;args:Row}[],writes:[] as {port:string;value:Row}[],status:null as Row|null}))
const actor=ownerId(50),company=ownerId(2),foreign=ownerId(999)
const result=(data:unknown,error:unknown=null)=>{const p=Promise.resolve({data,error});return Object.assign(p,{abortSignal:()=>p})}
const stop=()=>new Error('DECLARED_FIRST_STATUS_BOUNDARY_NO_PERSISTENCE')
function rpc(name:string,args:Row){
 io.calls.push({name,args:structuredClone(args)})
 if(name==='ediel_read_prodat_bilateral_source_capability_v1')return result(null)
 if(name==='ediel_read_technical_source_endpoint_v2')return result(null)
 if(name==='gridex_actor_has_company_permission')return result(args.p_company_id===company&&args.p_actor_user_id===actor&&
  ['communication.read','communication.write','ediel_testing.write'].includes(String(args.p_permission)))
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
  return {data:single?data[0]??null:data,error:null,count:data.length}
 }
 const q={select:(value='*')=>{columns=value;return q},eq:(key:string,value:unknown)=>{predicates.push(row=>row[key]===value);return q},
  not:(key:string,op:string,value:unknown)=>{if(op!=='is')throw Error('UNDECLARED_REQUIRED_START_NOT');predicates.push(row=>row[key]!==value);return q},
  lte:()=>q,or:()=>q,limit:()=>q,abortSignal:()=>q,
  update:(value:Row)=>{io.writes.push({port:'table:'+name,value:structuredClone(value)});return q},
  maybeSingle:async()=>read(true),single:async()=>read(true),
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
function use(source:EdielMessageRow){
 io.source=source;io.rows=ownerRows();io.rows.ediel_messages=[source as unknown as Row]
 io.rows.customers=[{id:ownerId(3),company_id:company},{id:ownerId(903),company_id:foreign}]
 io.rows.metering_permissions=[{id:ownerId(904),company_id:company,status:'pending'},{id:ownerId(905),company_id:foreign,status:'active'}]
 for(const name of ['ediel_actor_settings','ediel_route_profiles','communication_routes'])io.rows[name]=[]
 io.calls=[];io.writes=[];io.status=null
}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-30T13:00:00Z'));use(message('A'))})
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()})
const own210=(issues:unknown)=>Array.isArray(issues)&&issues.some(item=>item.prodatDiagnostic?.kind==='field'&&
 item.prodatDiagnostic.fieldNumber==='210'&&item.prodatDiagnostic.errorKind==='missing'&&
 item.prodatDiagnostic.occurrence.objectId==='735123456789012345'&&item.prodatDiagnostic.occurrence.lineItemReference==='CASE-1')

it.each(['A','D'] as const)('actual actorless %s observation reports physical R210 without minting business authority',async subtype=>{
 use(message(subtype));expect(validateEdifactSyntax(io.source).ok).toBe(true)
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
 use(message(subtype));const before=structuredClone({source:io.source,graphs:io.rows})
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
it('invalid full syntax preserves syntax rejection before the new required-start authority reads',async()=>{
 use({...message('A'),raw_payload:message('A').raw_payload!.replace(/UNT\+\d+/, 'UNT+999')})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source)
 expect(decision.syntaxDecision).toBe('rejected');expect(io.calls).toEqual([])
})
it.each(['A','D'] as const)('present own start in %s remains a capability hold, never a false missing210 or archived-date substitute',async subtype=>{
 use(message(subtype,false));expect(validateEdifactSyntax(io.source).ok).toBe(true)
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(io.source)
 expect(own210(decision.issues)).toBe(false)
 if(subtype==='A')expect(decision.policy).toBeNull()
 else expect(decision.policy?.subtype).toBe('D')
 expect(decision.applicationDecision).not.toBe('accepted');expect(decision.responsePlan.some(p=>p.family==='APERAK'&&p.outcome==='positive')).toBe(false)
})
