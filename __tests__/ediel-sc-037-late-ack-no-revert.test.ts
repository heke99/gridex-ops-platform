// masterplan: SC-037
// P-11 on_failure: a late negative CONTRL/APERAK (canonical updater) or
// UTILTS_ERR/negative ACK (legacy updater) never rolls back a supplier switch
// that Z04 already confirmed, and never touches the confirmed period. Before
// Z04 a negative ACK still rejects the switch. A positive ACK (SMTP-level
// acceptance, CONTRL, APERAK) never moves the start or activates anything.
// Declared port: an in-memory Supabase fake that honours eq/in/not/is filters.
import {beforeEach,describe,expect,it,vi} from 'vitest'
const db=vi.hoisted(()=>({rows:{} as Record<string,Record<string,unknown>[]>}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 let op:'select'|'update'|'insert'='select',patch:Record<string,unknown>={};const filters:((r:Record<string,unknown>)=>boolean)[]=[]
 const q:Record<string,unknown>={}
 const exec=()=>{const rows=db.rows[table]??=[]
  if(op==='update'){const hit=rows.filter(r=>filters.every(f=>f(r)));hit.forEach(r=>Object.assign(r,patch));return {data:hit,error:null}}
  if(op==='insert'){const list=(Array.isArray(patch)?patch:[patch]).map((p,i)=>({id:`${table}-${rows.length+i}`,...p}));rows.push(...list);return {data:list.length===1?list[0]:list,error:null}}
  return {data:rows.filter(r=>filters.every(f=>f(r))),error:null}}
 Object.assign(q,{select:()=>q,limit:()=>q,order:()=>q,
  eq:(c:string,v:unknown)=>{filters.push(r=>r[c]===v);return q},is:(c:string,v:unknown)=>{filters.push(r=>(r[c]??null)===v);return q},
  in:(c:string,v:unknown[])=>{filters.push(r=>v.includes(r[c]));return q},
  not:(c:string,o:string,v:unknown)=>{const list=Array.isArray(v)?v.map(String):String(v).replace(/[()"]/g,'').split(',');filters.push(r=>o!=='in'||!list.includes(String(r[c])));return q},
  update:(p:Record<string,unknown>)=>{op='update';patch=p;return q},insert:(p:Record<string,unknown>)=>{op='insert';patch=p;return q},upsert:(p:Record<string,unknown>)=>{op='insert';patch=p;return q},
  maybeSingle:async()=>{const r=exec();return {data:Array.isArray(r.data)?r.data[0]??null:r.data,error:null}},
  single:async()=>{const r=exec();return {data:Array.isArray(r.data)?r.data[0]??null:r.data,error:null}},
  then:(ok:(v:unknown)=>unknown,err?:(e:unknown)=>unknown)=>Promise.resolve(exec()).then(ok,err)})
 return q}}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:async()=>undefined}))
vi.mock('@/lib/ediel/inbound/receptions',()=>({recordInboundReception:async()=>({first:true}),requireFirstReception:()=>undefined}))
vi.mock('@/lib/ediel/core/dedupe',async(orig)=>({...(await orig<object>()),findInboundDuplicateByCanonicalIdentity:async()=>null}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory',()=>({createInboundMailTask:async()=>'task'}))
import {applyCanonicalInboundAckStatusUpdate} from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'
import {applySafeInboundStatusUpdate} from '@/lib/inbound-mail/inboundStatusUpdater'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {classifyCanonicalInboundAck} from '@/lib/ediel/ack/inboundAckOutcome'

const env=(token:string,ref:string,segments:string[])=>parseEdifactPayload(EdifactEnvelopeCodec.encode({
 sender:'7300000000002',receiver:'7300000000001',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'A-1',
 applicationReference:ref,acknowledgementRequest:false,environment:'test',createdAt:new Date('2026-10-04T12:00:00Z'),
 messages:[{messageReference:'1',messageTypeToken:token,businessSegments:segments}]}))
const aperak=(erc:string)=>env('APERAK:D:96A:UN:E2SE6A','23-DDQ-PRODAT',['BGM++ACK-1+34','DTM+137:202610041200:203','RFF+ACW:DOC-1',
 'NAD+FR+7300000000002:160:SVK','NAD+DO+7300000000001:160:SVK',`ERC+${erc}::260`,'FTX+AAO+++SYNTHETIC ACK','RFF+Z07:POINT-1','RFF+LI:LI-1'])
const contrl=(action:'1'|'4')=>env('CONTRL:2:2:UN:EDIEL2','23-DDQ-PRODAT',[`UCI+ORIG-I+7300000000001:14+7300000000002:14+${action}`])
const ACKS={'negative APERAK':()=>aperak('9'),'negative CONTRL':()=>contrl('4'),'positive APERAK':()=>aperak('100'),'positive CONTRL':()=>contrl('1')}
type AckName=keyof typeof ACKS
const NEGATIVE:AckName[]=['negative APERAK','negative CONTRL'],POSITIVE:AckName[]=['positive APERAK','positive CONTRL']

const PERIOD={id:'period-1',company_id:'company',supplier_switch_request_id:'switch-1',status:'confirmed_by_grid_owner',start_date:'2026-11-01',market_start_at:'2026-10-31T23:00:00Z',activated_at:null}
const match={status:'matched',entityType:'outbound_request',entityId:'outbound-1',reasons:[],candidates:[{outbound_request_id:'outbound-1',source_type:'supplier_switch_request',source_id:'switch-1'}]} as never
const noPoint={status:'missing',entityId:null,reasons:[],candidates:[]} as never
const seed=(switchStatus:string,z04:boolean)=>{db.rows={
 outbound_requests:[{id:'outbound-1',company_id:'company',status:z04?'confirmed':'sent',source_type:'supplier_switch_request',source_id:'switch-1',response_payload:z04?{z04:'kept'}:null}],
 supplier_switch_requests:[{id:'switch-1',company_id:'company',status:switchStatus,requested_start_date:'2026-11-01',confirmed_start_date:z04?'2026-11-01':null,inbound_z04_message_id:z04?'z04-in':null,failed_at:null,failure_reason:null}],
 supply_periods:[{...PERIOD}],
 inbound_email_messages:[{id:'mail',company_id:'company',environment:'test',received_at:'2026-10-04T12:00:00Z'}],
 ediel_messages:[{id:'z03-out',company_id:'company',environment:'test',direction:'outbound',outbound_request_id:'outbound-1',message_code:'Z03',status:'sent'}],
 ediel_message_events:[],inbound_mail_tasks:[]}}
const canonical=(parsed:ReturnType<typeof aperak>)=>applyCanonicalInboundAckStatusUpdate({companyId:'company',environment:'test',parsed,outboundMatch:match,meteringPointMatch:noPoint,inboundEmailMessageId:'mail'})
const legacy=(parsed:ReturnType<typeof aperak>)=>applySafeInboundStatusUpdate({companyId:'company',environment:'test',parsed,actorUserId:'actor',parseResultId:'parse',inboundEmailMessageId:'mail',outboundMatch:match,meteringPointMatch:noPoint})
const sw=()=>db.rows.supplier_switch_requests[0]
const startFields=()=>({requested_start_date:sw().requested_start_date,confirmed_start_date:sw().confirmed_start_date})

it('fixtures classify as intended',()=>{
 for(const n of NEGATIVE)expect(classifyCanonicalInboundAck(ACKS[n]()).outcome,n).toBe('negative')
 for(const n of POSITIVE)expect(classifyCanonicalInboundAck(ACKS[n]()).outcome,n).toBe('positive')
})

// The legacy updater is only reached for CONTRL by direct callers and its own
// CONTRL negativity check differs (UCI 7); its negative cases here are APERAK
// plus the UTILTS_ERR block below.
describe.each([['canonical',canonical,NEGATIVE],['legacy',legacy,['negative APERAK'] as AckName[]]] as const)('%s updater',(_name,run,negatives)=>{
 describe.each(['accepted','completed','confirmed'])('after Z04 (switch %s)',status=>{
  beforeEach(()=>seed(status,true))
  it.each(negatives)('a late %s keeps the switch status and the confirmed period untouched',async ack=>{
   await run(ACKS[ack]())
   expect(sw()).toMatchObject({status,failed_at:null,failure_reason:null,inbound_z04_message_id:'z04-in'})
   expect(startFields()).toEqual({requested_start_date:'2026-11-01',confirmed_start_date:'2026-11-01'})
   expect(db.rows.supply_periods).toEqual([PERIOD])
  })
 })
 describe.each(['submitted','sent','queued'])('before Z04 (switch %s)',status=>{
  beforeEach(()=>seed(status,false))
  it.each(negatives)('a %s still rejects the switch',async ack=>{
   await run(ACKS[ack]())
   expect(sw().status).toBe('rejected')
   expect(sw().failed_at).toEqual(expect.any(String))
   expect(db.rows.supply_periods).toEqual([PERIOD])
  })
 })
 describe.each([['submitted',false],['accepted',true]] as const)('positive ACK on switch %s',(status,z04)=>{
  beforeEach(()=>seed(status,z04))
  it.each(POSITIVE)('a %s never moves the start or activates anything',async ack=>{
   const before=startFields()
   await run(ACKS[ack]())
   expect(sw().status).toBe(status)
   expect(startFields()).toEqual(before)
   expect(db.rows.supply_periods).toEqual([PERIOD])
  })
 })
})

describe('legacy UTILTS_ERR',()=>{
 const utiltsErr=()=>({...aperak('9'),messageFamily:'UTILTS_ERR',messageCode:null}) as ReturnType<typeof aperak>
 it('after Z04 a late UTILTS_ERR keeps the accepted switch',async()=>{
  seed('accepted',true);await legacy(utiltsErr())
  expect(sw()).toMatchObject({status:'accepted',failed_at:null});expect(db.rows.supply_periods).toEqual([PERIOD])
 })
 it('before Z04 a UTILTS_ERR still rejects the switch',async()=>{
  seed('sent',false);await legacy(utiltsErr())
  expect(sw().status).toBe('rejected')
 })
})
