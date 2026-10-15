// masterplan: ACK-01, AT-ACK-01
import {beforeEach,describe,expect,it,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {InboundEntityMatch} from '@/lib/inbound-mail/inboundMatcher'
import type {InboundReception} from '@/lib/ediel/inbound/receptions'
import type {CommittedInboundAck} from '@/lib/ediel/ack/committedInboundAck'
import type {ParsedEdifactEnvelope} from '@/lib/inbound-mail/edielEmailParser'

type Row=Record<string,unknown>
type Filter={column:string;kind:'eq'|'is'|'in'|'not';value:unknown}
type Write={op:'insert'|'update'|'upsert';table:string;row:Row;filters:Filter[]}
type RpcReply={data:unknown;error:unknown}
type AuthorizeInput=Parameters<typeof import('@/lib/ediel/services/authorization').assertEdielTenantActor>[0]
type ReceptionInput=Parameters<typeof import('@/lib/ediel/inbound/receptions').recordInboundReception>[0]
type ReaderInput=Parameters<typeof import('@/lib/ediel/ack/committedInboundAck').readCommittedInboundAck>[0]
type ResolveInput=Parameters<typeof import('@/lib/ediel/core/runtimeDecision').resolveCanonicalRuntimeDecisionWithRegistry>
type LedgerInput=Parameters<typeof import('@/lib/ediel/core/receivedSourceValidationLedger').recordReceivedSourceValidation>[0]
// These are finite UNIT boundary responses, never genuine PG source authority.
const io=vi.hoisted(()=>({
 writes:[] as Write[],tasks:[] as Row[],trace:[] as string[],tables:new Map<string,Row[]>(),
 rpcCalls:[] as {name:string;args:Row}[],queries:[] as string[],committed:false,replay:false,
 sourceApplies:0,mutations:0,nextTransitionError:null as Error|null,
 query:(_table:string):unknown=>{throw new Error('unit_query_unconfigured')},
 rpc:async(_name:string,_args:Row):Promise<RpcReply>=>{throw new Error('unit_rpc_unconfigured')},
 reception:(_input:ReceptionInput):InboundReception=>{throw new Error('unit_reception_unconfigured')},
 reader:(_input:ReaderInput):CommittedInboundAck|null=>{throw new Error('unit_reader_unconfigured')},
}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 from:(table:string)=>io.query(table),rpc:(name:string,args:Row)=>io.rpc(name,args),
}}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory',()=>({createInboundMailTask:async(task:Row)=>{io.tasks.push(task);return 'unit-task'}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:async(input:AuthorizeInput)=>{
 io.trace.push('write_actor');expect(input).toEqual({companyId:ids.company,actorUserId:ids.actor,permission:'communication.write'})
}}))
vi.mock('@/lib/ediel/inbound/receptions',()=>({
 recordInboundReception:async(input:ReceptionInput)=>{io.trace.push('reception_record');return io.reception(input)},
 requireFirstReception:(r:InboundReception)=>{io.trace.push('reception_first');expect(r.classification).toBe('first_reception');expect(r.status).toBe('observed')},
 InboundReceptionHeldError:class extends Error{constructor(readonly reception:InboundReception){super(reception.reason??'unit-held')}},
}))
vi.mock('@/lib/ediel/ack/committedInboundAck',()=>({readCommittedInboundAck:async(input:ReaderInput)=>{io.trace.push('reader');return io.reader(input)}}))
vi.mock('@/lib/ediel/ack/sourceCorrelation',()=>({
 readInboundAckSourceCorrelation:(message:EdielMessageRow)=>({classification:classifyCanonicalInboundAck(parseEdifactPayload(message.raw_payload??''))}),
 qualifyInboundAckSourceCandidates:(input:{ackMessage:EdielMessageRow;candidates:EdielMessageRow[];expectedCompanyId:string|null})=>{
  expect(input.expectedCompanyId).toBe(ids.company);expect(input.ackMessage.id).toBe(ids.ack)
  expect(input.candidates).toHaveLength(1);expect(input.candidates[0]).toMatchObject({id:ids.source,company_id:ids.company,direction:'outbound',environment:'test'})
  return {status:'unique',sourceMessage:input.candidates[0]}
 },
}))
vi.mock('@/lib/ediel/core/runtimeDecision',()=>({resolveCanonicalRuntimeDecisionWithRegistry:async(...args:ResolveInput)=>{
 io.trace.push('resolver');expect(args[0]).toMatchObject({id:ids.ack,company_id:ids.company});expect(args[1]).toEqual({actorUserId:ids.actor})
 return {syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'not_applicable'}
}}))
vi.mock('@/lib/ediel/core/receivedSourceValidationLedger',()=>({recordReceivedSourceValidation:async(input:LedgerInput)=>{
 io.trace.push('ledger');expect(input.original).toBe(input.validated);expect(input.original.id).toBe(ids.ack);expect(input.resolvedCompanyId).toBe(ids.company)
 expect(input.decision).toMatchObject({syntaxDecision:'accepted',applicationDecision:'accepted'})
 return {status:'recorded',sourceDisposition:'not_established'}
}}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:()=>unexpected('flow-event'),linkEdielMessage:()=>unexpected('link'),updateEdielMessageStatus:()=>unexpected('flow-status')}))
vi.mock('@/lib/ediel/flows/shared',()=>({ensureActorUserId:(actor:string)=>{
 if(actor!==ids.actor)throw new Error('unit_current_actor_required');return actor
},getGridOwnerDataRequestById:()=>unexpected('data-request-read')}))
vi.mock('@/lib/cis/db',()=>({getOutboundRequestById:()=>unexpected('outbound-request-read'),updateGridOwnerDataRequestStatus:()=>unexpected('data-request-write'),updateOutboundRequestStatus:()=>unexpected('outbound-request-write')}))
vi.mock('@/lib/operations/db',()=>({createSupplierSwitchEvent:()=>unexpected('switch-event'),updateSupplierSwitchRequestStatus:()=>unexpected('direct-switch-write')}))
vi.mock('@/lib/customer-cases/db',()=>({syncCustomerCaseCancellationAck:()=>unexpected('customer-case')}))
vi.mock('@/lib/ediel/actorTestingEngine',()=>({syncActorTestingForMessage:()=>unexpected('actor-testing')}))
vi.mock('@/lib/errors',()=>({formatErrorMessage:(error:unknown)=>String(error)}))
vi.mock('@/lib/ediel/tenant/resolveInboundTenant',()=>({tenantResolutionForStorage:()=>unexpected('tenant-storage')}))

import {applyCanonicalInboundAckStatusUpdate} from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'
import {buildContrlDraft} from '@/lib/ediel/ack'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {classifyCanonicalInboundAck} from '@/lib/ediel/ack/inboundAckOutcome'

const ids={company:'10000000-0000-4000-8000-000000000001',actor:'20000000-0000-4000-8000-000000000001',mail:'30000000-0000-4000-8000-000000000001',parse:'40000000-0000-4000-8000-000000000001',ack:'50000000-0000-4000-8000-000000000001',source:'60000000-0000-4000-8000-000000000001',switch:'70000000-0000-4000-8000-000000000001',other:'70000000-0000-4000-8000-000000000002'}
const receivedAt='2026-10-01T08:00:00.000Z'
const hash=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex')
const copy=<T,>(value:T):T=>structuredClone(value)
function unexpected(port:string):never{throw new Error(`unit_unexpected_port:${port}`)}
const prodat=EdifactEnvelopeCodec.encode({sender:'7300000000002',receiver:'7300000000001',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'ORIG-I',environment:'test',
 acknowledgementRequest:true,applicationReference:'23-DDQ-PRODAT',messages:[{messageReference:'M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:['BGM+Z01+DOC-1+9']}]})
const source=(raw:string,family='PRODAT',code='Z01')=>({id:'00000000-0000-4000-8000-000000000001',company_id:null,direction:'inbound',message_standard:'edifact',message_family:family,
 message_code:code,raw_payload:raw,environment:'test',test_flag:1,application_reference:'23-DDQ-PRODAT'}) as unknown as EdielMessageRow
const segments=(raw:string)=>EdifactEnvelopeCodec.decode(raw)

const outgoingRaw=EdifactEnvelopeCodec.encode({sender:'7300000000001',receiver:'7300000000002',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'ORIG-I',environment:'test',acknowledgementRequest:true,applicationReference:'23-DDQ-PRODAT',messages:[{messageReference:'OUT-1',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:['BGM+Z03+DOC-1+9']}]})
const original=()=>({...source(outgoingRaw,'PRODAT','Z03'),id:ids.source,company_id:ids.company,direction:'outbound' as const,interchange_reference:'ORIG-I',switch_request_id:ids.switch,outbound_request_id:null,grid_owner_data_request_id:null,message_sent_at:receivedAt,immutable_rendered_at:receivedAt})
const parsedContrl=(action:string):ParsedEdifactEnvelope=>parseEdifactPayload(EdifactEnvelopeCodec.encode({sender:'7300000000002',receiver:'7300000000001',senderQualifier:'14',receiverQualifier:'14',interchangeReference:`C-${action}`,environment:'test',acknowledgementRequest:false,applicationReference:'23-DDQ-PRODAT',messages:[{messageReference:'ACK-1',messageTypeToken:'CONTRL:2:2:UN:EDIEL2',businessSegments:[`UCI+ORIG-I+7300000000001:14+7300000000002:14+${action}`]}]}))
const parsedAperak=():ParsedEdifactEnvelope=>parseEdifactPayload(EdifactEnvelopeCodec.encode({sender:'7300000000002',receiver:'7300000000001',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'A-1',environment:'test',acknowledgementRequest:false,applicationReference:'23-DDQ-PRODAT',messages:[{messageReference:'ACK-A',messageTypeToken:'APERAK:D:96A:UN:E2SE6A',businessSegments:['BGM+312+A+27','ERC+40::260']}]}))
const matched:InboundEntityMatch={status:'matched',entityType:'outbound_request',entityId:'80000000-0000-4000-8000-000000000001',confidence:1,reasons:[],candidates:[{source_type:'supplier_switch_request',source_id:ids.switch}]}
const ordinaryMatch:InboundEntityMatch={status:'matched',entityType:'ediel_message',entityId:ids.source,confidence:1,reasons:[],candidates:[{id:ids.source,switch_request_id:null,outbound_request_id:null}]}
const noPoint:InboundEntityMatch={status:'missing',entityType:null,entityId:null,confidence:0,reasons:[],candidates:[]}
type AckInput=Parameters<typeof applyCanonicalInboundAckStatusUpdate>[0]
const update=(input:Partial<AckInput>={})=>applyCanonicalInboundAckStatusUpdate({companyId:ids.company,environment:'test',actorUserId:ids.actor,parseResultId:ids.parse,parsed:parsedContrl('4'),outboundMatch:matched,meteringPointMatch:noPoint,inboundEmailMessageId:ids.mail,...input})
const rows=(table:string)=>{const value=io.tables.get(table);if(!value)unexpected(`table:${table}`);return value}
const own=()=>rows('ediel_messages').find(row=>row.id===ids.ack)!
const recipient=()=>rows('supplier_switch_requests').find(row=>row.id===ids.switch)!
function receipt():CommittedInboundAck{return {kind:'exact_receipt',sourceMessageId:ids.source,result:{version:1,sourceMessage:original(),outcome:'negative',scope:'interchange',scopeOutcomes:[{reference:'ORIG-I',outcome:'negative'}],finalAckReached:true,wholeSourceRejected:true,sourceAccepted:false,failureReason:'UNIT negative CONTRL',idempotent:io.replay}}}
function query(table:string){
 rows(table);io.queries.push(table)
 let op:'select'|'insert'|'update'|'upsert'='select',payload:Row|null=null,single=false,limit=Infinity
 const filters:Filter[]=[]
 let done:Promise<{data:unknown;error:null}>|null=null
 const matches=(row:Row)=>filters.every(f=>f.kind==='eq'||f.kind==='is'?row[f.column]===f.value:f.kind==='in'?(f.value as unknown[]).includes(row[f.column]):!String(f.value).includes(`"${String(row[f.column])}"`))
 const execute=()=>{
  if(done)return done
  done=Promise.resolve().then(()=>{
   if(op==='select'){io.trace.push(`read:${table}`);const selected=rows(table).filter(matches).slice(0,limit).map(copy);return {data:single?(selected[0]??null):selected,error:null}}
   if(!payload)unexpected('empty-write')
   io.writes.push({op,table,row:copy(payload),filters:copy(filters)})
   if(table==='supplier_switch_requests')unexpected('direct-supplier-write')
   if(op==='upsert')unexpected('upsert')
   let changed:Row[]
   if(op==='insert'){const row={...copy(payload),id:payload.id??(table==='ediel_messages'?ids.ack:'unit-event')};rows(table).push(row);changed=[row]}
   else{changed=rows(table).filter(matches);for(const row of changed)Object.assign(row,copy(payload))}
   io.trace.push(`${op}:${table}`);return {data:single?(copy(changed[0])??null):changed.map(copy),error:null}
  })
  return done
 }
 const q={select:(_columns?:string)=>q,eq:(column:string,value:unknown)=>{filters.push({column,kind:'eq',value});return q},is:(column:string,value:unknown)=>{filters.push({column,kind:'is',value});return q},in:(column:string,value:unknown[])=>{filters.push({column,kind:'in',value});return q},not:(column:string,operator:string,value:unknown)=>{if(operator!=='in')unexpected(`not:${operator}`);filters.push({column,kind:'not',value});return q},limit:(n:number)=>{limit=n;return q},maybeSingle:()=>{single=true;return q},single:()=>{single=true;return q},insert:(row:Row)=>{op='insert';payload=row;return q},update:(row:Row)=>{op='update';payload=row;return q},upsert:(row:Row)=>{op='upsert';payload=row;return q},then:<TResult1=unknown,TResult2=never>(resolve?:((value:{data:unknown;error:null})=>TResult1|PromiseLike<TResult1>)|null,reject?:((reason:unknown)=>TResult2|PromiseLike<TResult2>)|null)=>execute().then(resolve,reject)}
 return q
}
function installModel(){
 io.writes=[];io.tasks=[];io.trace=[];io.rpcCalls=[];io.queries=[];io.committed=false;io.replay=false;io.sourceApplies=0;io.mutations=0;io.nextTransitionError=null
 io.tables=new Map<string,Row[]>([['inbound_email_messages',[{id:ids.mail,company_id:ids.company,environment:'test',received_at:receivedAt}]],['ediel_messages',[original()]],['supplier_switch_requests',[{id:ids.switch,company_id:ids.company,status:'submitted',outbound_z03_message_id:ids.source,inbound_z04_message_id:null,updated_by:null,metadata:{nested:{keep:true}},unknown_scalar:'retain'},{id:ids.other,company_id:ids.company,status:'submitted',metadata:{unrelated:true}}]],['ediel_message_events',[]],['outbound_requests',[{id:matched.entityId,company_id:ids.company,status:'submitted'}]],['grid_owner_data_requests',[]]])
 io.query=query
 io.reception=(input)=>{
  expect(input).toEqual({companyId:ids.company,messageId:ids.ack,inboundEmailMessageId:ids.mail,parseResultId:ids.parse,actorUserId:ids.actor})
  const digest=hash(String(own().raw_payload));return {companyId:ids.company,sourceMessageId:ids.ack,inboundEmailMessageId:ids.mail,parseResultId:ids.parse,receptionId:'90000000-0000-4000-8000-000000000001',classification:'first_reception',isReplay:io.replay,receivedAt,canonicalPayloadHash:digest,receivedPayloadHash:digest,responseRequestId:null,status:'observed',reason:null,businessEffectAuthorized:false}
 }
 io.reader=(input)=>{expect(input.actorUserId).toBe(ids.actor);expect(input.message).toMatchObject({id:ids.ack,company_id:ids.company,direction:'inbound',raw_payload:own().raw_payload});return io.committed?receipt():null}
 io.rpc=async(name,args)=>{
  io.rpcCalls.push({name,args:copy(args)});io.trace.push(name)
  if(name==='gridex_read_inbound_ack_source_v1'){
   expect(args).toEqual({p_company_id:ids.company,p_environment:'test',p_ack_message_id:ids.ack});return {data:{version:1,sourceMessage:original()},error:null}
  }
  if(name==='gridex_apply_inbound_ack_source_v1'){
   expect(args).toEqual({p_company_id:ids.company,p_environment:'test',p_ack_message_id:ids.ack,p_source_message_id:ids.source,p_actor_user_id:ids.actor});io.sourceApplies++;io.committed=true
   return {data:{version:1,sourceMessage:original(),outcome:'negative',finalAckReached:true,wholeSourceRejected:true,sourceAccepted:false,failureReason:'UNIT negative CONTRL'},error:null}
  }
  if(name!=='gridex_apply_inbound_ack_switch_transition_v1')unexpected(`rpc:${name}`)
  const expectedText=JSON.stringify(recipient()),ackHash=hash(String(own().raw_payload)),sourceHash=hash(outgoingRaw)
  expect(ackHash).not.toBe(sourceHash)
  expect(args).toEqual({p_company_id:ids.company,p_environment:'test',p_actor_user_id:ids.actor,p_ack_message_id:ids.ack,p_ack_payload_hash:ackHash,p_source_message_id:ids.source,p_source_payload_hash:sourceHash,p_switch_request_id:ids.switch,p_negative_status:'rejected',p_expected_request:expectedText})
  if(io.nextTransitionError){const error=io.nextTransitionError;io.nextTransitionError=null;throw error}
  const changed=recipient().status==='submitted'
  if(changed){Object.assign(recipient(),{status:'rejected',updated_by:ids.actor});io.mutations++}
  return {data:{version:1,companyId:ids.company,environment:'test',actorUserId:ids.actor,ackMessageId:ids.ack,ackPayloadHash:ackHash,sourceMessageId:ids.source,sourcePayloadHash:sourceHash,switchRequestId:ids.switch,negativeStatus:'rejected',expectedRequestHash:hash(expectedText),disposition:changed?'mutated_failure':'already_terminal',changed,request:copy(recipient())},error:null}
 }
}
function expectOwnAlarm(){expect(own()).toMatchObject({id:ids.ack,company_id:ids.company,environment:'test',inbound_email_message_id:ids.mail,status:'failed',processing_status:'manual_review',contrl_status:'rejected',syntax_check_status:'rejected',ack_outcome:'negative'});expect(own().failure_reason).toEqual(expect.any(String));expect(String(own().failure_reason)).not.toBe('')}
function expectNoFallback(){expect(io.tasks).toEqual([]);expect(io.writes.filter(w=>['supplier_switch_requests','outbound_requests','ediel_message_events'].includes(w.table))).toEqual([])}
beforeEach(installModel)

describe('ACK-01 CONTRL on the right correlation level, no national APERAK content',()=>{
 it('outbound CONTRL uses CONTRL:2:2:UN with UCI result 1 (accepted) or 4 (rejected) for the original interchange',()=>{
  for(const [outcome,action] of [['positive','1'],['negative','4']] as const){
   const draft=buildContrlDraft({sourceMessage:source(prodat),outcome})
   const wire=segments(draft.rawPayload!)
   expect(wire.segments.find(s=>s.tag==='UNH')!.raw).toContain('CONTRL:2:2:UN')
   const uci=wire.segments.find(s=>s.tag==='UCI')!
   expect(segmentComposite(uci,1,wire.una)).toEqual(['ORIG-I'])
   expect(segmentComposite(uci,4,wire.una)).toEqual([action])
   // Prohibited: no national APERAK checks (ERC/FTX/RFF+ACW/DOC) are carried in CONTRL.
   expect(wire.segments.map(s=>s.tag).filter(t=>['ERC','FTX','RFF','DOC','BGM'].includes(t))).toEqual([])
  }
 })
 it('avoids an acknowledgement loop: a CONTRL never requests a CONTRL and is never itself acknowledged',()=>{
  const draft=buildContrlDraft({sourceMessage:source(prodat),outcome:'positive'})
  expect(segments(draft.rawPayload!).acknowledgementRequest).toBeFalsy()
  expect(draft.requiresContrl).toBe(false)
  const contrl=EdifactEnvelopeCodec.encode({sender:'7300000000002',receiver:'7300000000001',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'C-1',environment:'test',
   acknowledgementRequest:false,messages:[{messageReference:'1',messageTypeToken:'CONTRL:2:2:UN:EDIEL2',businessSegments:['UCI+X+A:14+B:14+7']}]})
  expect(()=>buildContrlDraft({sourceMessage:source(contrl,'CONTRL','CONTRL')})).toThrow(/inte kvitteras med nytt ack/)
 })
 it('a received negative CONTRL (UCI 4) raises an alarm: manual review, warning event and the outbound flow marked rejected',async()=>{
  const unrelated=copy(rows('supplier_switch_requests')[1]),parsed=parsedContrl('4')
  expect(classifyCanonicalInboundAck(parsed)).toMatchObject({outcome:'negative',code:'4'})
  const result=await update({parsed})
  expect(result).toMatchObject({status:'manual_review',matchStatus:'negative_contrl',inboundEdielMessageId:ids.ack})
  expectOwnAlarm();expect(own().raw_payload).toBe(parsed.rawPayload);expect(own().message_received_at).toBe(receivedAt)
  expect(recipient()).toMatchObject({id:ids.switch,status:'rejected',updated_by:ids.actor,outbound_z03_message_id:ids.source,metadata:{nested:{keep:true}},unknown_scalar:'retain'})
  expect(rows('supplier_switch_requests')[1]).toEqual(unrelated);expect(io.mutations).toBe(1);expectNoFallback()
  expect(io.trace).toEqual(expect.arrayContaining(['write_actor','insert:ediel_messages','reception_record','reception_first','reader','resolver','ledger','gridex_apply_inbound_ack_source_v1','gridex_apply_inbound_ack_switch_transition_v1']))
  expect(io.trace.indexOf('write_actor')).toBeLessThan(io.trace.indexOf('insert:ediel_messages'))
  expect(io.trace.indexOf('reception_record')).toBeLessThan(io.trace.indexOf('reception_first'))
  expect(io.trace.indexOf('reception_first')).toBeLessThan(io.trace.indexOf('reader'))
  expect(io.trace.indexOf('resolver')).toBeLessThan(io.trace.indexOf('ledger'))
  expect(io.trace.indexOf('ledger')).toBeLessThan(io.trace.indexOf('gridex_apply_inbound_ack_source_v1'))
  expect(io.trace.indexOf('gridex_apply_inbound_ack_source_v1')).toBeLessThan(io.trace.lastIndexOf('reader'))
  expect(io.trace.lastIndexOf('reader')).toBeLessThan(io.trace.indexOf('gridex_apply_inbound_ack_switch_transition_v1'))
  // The existing ordinary route retains the original urgent-task/warning controls.
  installModel()
  const ordinaryOriginal=rows('ediel_messages').find(row=>row.id===ids.source)!
  ordinaryOriginal.switch_request_id=null;ordinaryOriginal.outbound_request_id=null
  expect(await update({outboundMatch:ordinaryMatch})).toMatchObject({status:'manual_review',matchStatus:'negative_contrl'})
  expectOwnAlarm();expect(io.tasks).toEqual([expect.objectContaining({priority:'urgent',taskType:'ediel_negative_contrl',actorUserId:ids.actor})])
  expect(io.writes.find(w=>w.table==='ediel_message_events')?.row).toMatchObject({ediel_message_id:ids.ack,event_status:'warning'})
  const ackWrite=io.writes.find(w=>w.table==='ediel_messages'&&w.op==='update')!
  expect(ackWrite.row).toMatchObject({contrl_status:'rejected',ack_outcome:'negative',related_message_id:ids.ack})
  expect(ackWrite.filters).toEqual(expect.arrayContaining([{column:'company_id',kind:'eq',value:ids.company},{column:'direction',kind:'eq',value:'outbound'},{column:'id',kind:'eq',value:ids.source}]))
  expect(io.rpcCalls).toEqual([]);expect(io.writes.some(w=>w.table==='supplier_switch_requests')).toBe(false)
 })
 it('a received positive CONTRL is recorded without alarm; an invalid action code opens an urgent task',async()=>{
  expect(await update({parsed:parsedContrl('1')})).toMatchObject({status:'processed'});expect(io.tasks).toEqual([])
  expect(io.writes.find(w=>w.table==='ediel_message_events')!.row).toMatchObject({event_status:'info'})
  expect(io.writes.some(w=>w.table==='supplier_switch_requests')).toBe(false);expect(io.rpcCalls).toEqual([])
  installModel()
  const invalid=await update({parsed:parsedContrl('9')})
  expect(invalid).toMatchObject({status:'manual_review',matchStatus:'invalid_ack'})
  expect(io.tasks[0]).toMatchObject({priority:'urgent',taskType:'ediel_invalid_ack'})
  expect(own()).toMatchObject({processing_status:'manual_review',validation_report:{status:'invalid_ack_manual_review'}})
  expect(io.writes.find(w=>w.table==='ediel_message_events')!.row).toMatchObject({event_status:'warning'})
  expect(io.rpcCalls).toEqual([])
 })
 it('every ACK status column written on ediel_messages exists in the committed schema (no retired syntax_status/application_status)',async()=>{
  const schema=readFileSync('supabase/schema.sql','utf8'),table=schema.slice(schema.indexOf('CREATE TABLE public.ediel_messages ('))
  const columns=new Set([...table.slice(0,table.indexOf('\n);')).matchAll(/^    ([a-z_0-9]+) /gm)].map(m=>m[1]))
  expect(columns.size).toBeGreaterThan(0);expect(columns.has('syntax_status')).toBe(false);expect(columns.has('application_status')).toBe(false)
  for(const action of ['4','1']){installModel();await update({parsed:parsedContrl(action)})
   for(const w of io.writes.filter(w=>w.table==='ediel_messages'&&w.row))for(const key of Object.keys(w.row))expect(columns.has(key),key).toBe(true)}
  installModel();await update({parsed:parsedAperak()})
  for(const w of io.writes.filter(w=>w.table==='ediel_messages'&&w.row))for(const key of Object.keys(w.row))expect(columns.has(key),key).toBe(true)
 })
 it('a matched supplier negative CONTRL without the current actor fails before every write',async()=>{
  expect(classifyCanonicalInboundAck(parsedContrl('4')).outcome).toBe('negative')
  await expect(update({actorUserId:undefined})).rejects.toThrow('ack_current_mail_scope_required')
  expect(io.writes).toEqual([]);expect(io.queries).toEqual([]);expect(io.rpcCalls).toEqual([]);expect(io.tasks).toEqual([]);expect(io.trace).toEqual([])
 })
 it('same-mail committed negative ACK retries only protected projection without duplicate negative diagnostics',async()=>{
  const parsed=parsedContrl('4')
  rows('ediel_messages').push({...source(parsed.rawPayload,'CONTRL','CONTRL'),id:ids.ack,company_id:ids.company,inbound_email_message_id:ids.mail,receiver_ediel_id:parsed.receiverEdielId,application_reference:parsed.applicationReference,status:'failed',processing_status:'manual_review',contrl_status:'rejected',syntax_check_status:'rejected',ack_outcome:'negative',failure_reason:'UNIT retained negative alarm',message_received_at:receivedAt})
  const alarm=copy(own());io.committed=true;io.replay=true;io.nextTransitionError=new Error('unit_transport_unknown')
  await expect(update({parsed})).rejects.toThrow('unit_transport_unknown')
  expect(recipient().status).toBe('submitted');expect(io.mutations).toBe(0);expectNoFallback()
  expect(await update({parsed})).toMatchObject({status:'manual_review',matchStatus:'negative_contrl',inboundEdielMessageId:ids.ack})
  expect(await update({parsed})).toMatchObject({status:'manual_review',matchStatus:'negative_contrl'})
  expectOwnAlarm();expect(own()).toEqual(alarm);expect(io.writes).toEqual([]);expectNoFallback();expect(io.mutations).toBe(1);expect(io.sourceApplies).toBe(0)
  expect(io.trace).not.toContain('resolver');expect(io.trace).not.toContain('ledger')
  expect(io.trace.filter(value=>value==='reception_first')).toHaveLength(3)
  expect(io.rpcCalls.every(call=>call.name==='gridex_apply_inbound_ack_switch_transition_v1')).toBe(true)
 })
})
