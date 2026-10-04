// masterplan: ACK-01, AT-ACK-01
import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({writes:[] as {op:string;table:string;row:Record<string,unknown>|null}[],tasks:[] as Record<string,unknown>[]}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 const q:Record<string,unknown>={}
 const write=(op:string)=>(row:Record<string,unknown>|null=null)=>{io.writes.push({op,table,row});return q}
 Object.assign(q,{select:()=>q,eq:()=>q,is:()=>q,in:()=>q,not:()=>q,limit:()=>q,order:()=>q,maybeSingle:()=>q,single:()=>q,
  insert:write('insert'),update:write('update'),upsert:write('upsert'),
  then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:table==='ediel_messages'&&io.writes.at(-1)?.table==='ediel_messages'?{id:'inbound-ack'}:null,error:null}).then(resolve)})
 return q}}}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory',()=>({createInboundMailTask:async(task:Record<string,unknown>)=>{io.tasks.push(task);return 'task'}}))
import {applyCanonicalInboundAckStatusUpdate} from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'
import {buildContrlDraft} from '@/lib/ediel/ack'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {ParsedEdifactEnvelope} from '@/lib/inbound-mail/edielEmailParser'
import {readFileSync} from 'node:fs'

const prodat=EdifactEnvelopeCodec.encode({sender:'7300000000002',receiver:'7300000000001',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'ORIG-I',environment:'test',
 acknowledgementRequest:true,applicationReference:'23-DDQ-PRODAT',messages:[{messageReference:'M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:['BGM+Z01+DOC-1+9']}]})
const source=(raw:string,family='PRODAT',code='Z01')=>({id:'00000000-0000-4000-8000-000000000001',company_id:null,direction:'inbound',message_standard:'edifact',message_family:family,
 message_code:code,raw_payload:raw,environment:'test',test_flag:1,application_reference:'23-DDQ-PRODAT'}) as unknown as EdielMessageRow
const segments=(raw:string)=>EdifactEnvelopeCodec.decode(raw)
const parsedContrl=(action:string)=>({messageFamily:'CONTRL',messageCode:'CONTRL',references:{UCI_ACTION:[action]},rawPayload:"UNH+1+CONTRL:2:2:UN:EDIEL2'",
 senderEdielId:'7300000000002',receiverEdielId:'7300000000001',interchangeReference:'C-1',applicationReference:null,bgmReference:null,transactionReference:null,errorCodes:[],freeText:[]}) as unknown as ParsedEdifactEnvelope
const matched={status:'matched',entityType:'outbound_request',entityId:'outbound-1',candidates:[{source_type:'supplier_switch_request',source_id:'switch-1'}]} as never
const noPoint={status:'unmatched',candidates:[]} as never
const update=(input:Partial<Parameters<typeof applyCanonicalInboundAckStatusUpdate>[0]>)=>applyCanonicalInboundAckStatusUpdate({companyId:'company',environment:'test',
 parsed:parsedContrl('4'),outboundMatch:matched,meteringPointMatch:noPoint,inboundEmailMessageId:'mail',...input})

beforeEach(()=>{io.writes=[];io.tasks=[]})

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
  const result=await update({})
  expect(result).toMatchObject({status:'manual_review',matchStatus:'negative_contrl'})
  expect(io.tasks).toEqual([expect.objectContaining({priority:'urgent',taskType:'ediel_negative_contrl'})])
  const inbound=io.writes.find(w=>w.table==='ediel_messages'&&w.op!=='update')!.row!
  expect(inbound).toMatchObject({status:'failed',processing_status:'manual_review'})
  expect(io.writes.find(w=>w.table==='ediel_message_events')!.row).toMatchObject({event_status:'warning'})
  expect(io.writes.find(w=>w.table==='ediel_messages'&&w.op==='update')!.row).toMatchObject({contrl_status:'rejected',ack_outcome:'negative'})
  expect(io.writes.find(w=>w.table==='supplier_switch_requests')!.row).toMatchObject({status:'rejected'})
 })
 it('a received positive CONTRL is recorded without alarm; an invalid action code opens an urgent task',async()=>{
  expect(await update({parsed:parsedContrl('1')})).toMatchObject({status:'processed'});expect(io.tasks).toEqual([])
  expect(io.writes.find(w=>w.table==='ediel_message_events')!.row).toMatchObject({event_status:'info'})
  expect(io.writes.some(w=>w.table==='supplier_switch_requests')).toBe(false)
  io.writes=[]
  const invalid=await update({parsed:parsedContrl('9')})
  expect(invalid).toMatchObject({status:'manual_review',matchStatus:'invalid_ack'})
  expect(io.tasks[0]).toMatchObject({priority:'urgent',taskType:'ediel_invalid_ack'})
 })
 it('every ACK status column written on ediel_messages exists in the committed schema (no retired syntax_status/application_status)',async()=>{
  const schema=readFileSync('supabase/schema.sql','utf8'),table=schema.slice(schema.indexOf('CREATE TABLE public.ediel_messages ('))
  const columns=new Set([...table.slice(0,table.indexOf('\n);')).matchAll(/^    ([a-z_0-9]+) /gm)].map(m=>m[1]))
  for(const action of ['4','1']){io.writes=[];await update({parsed:parsedContrl(action)})
   for(const w of io.writes.filter(w=>w.table==='ediel_messages'&&w.row))for(const key of Object.keys(w.row!))expect(columns.has(key),key).toBe(true)}
  const aperak={...parsedContrl('4'),messageFamily:'APERAK',messageCode:'APERAK',references:{},applicationReference:'23-DDQ-PRODAT',messageTypeVersion:{type:'APERAK',version:'D',release:'96A',controllingAgency:'UN',associationAssignedCode:'E2SE6A'},messageFunctionCode:'27',errorCodes:['40'],rawPayload:"UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+312+A+27'ERC+40::260'"} as unknown as ParsedEdifactEnvelope
  io.writes=[];await update({parsed:aperak})
  for(const w of io.writes.filter(w=>w.table==='ediel_messages'&&w.row))for(const key of Object.keys(w.row!))expect(columns.has(key),key).toBe(true)
 })
})
