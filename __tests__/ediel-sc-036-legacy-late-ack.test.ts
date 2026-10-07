// masterplan: SC-036
// Legacy inbound updater: a late positive APERAK or CONTRL after Z04 keeps the
// confirmed request and its Z04 payload, and completes the Z03 ACK columns.
// Declared ports: in-memory Supabase tables, tenant actor, reception and duplicate lookups.
// edielInboundProcessor routes every CONTRL/APERAK to the canonical updater; these
// legacy branches are only reachable by direct callers. The physical intake
// projection and direct consumer must agree with the canonical ACK outcome.
import {beforeEach,expect,it,vi} from 'vitest'
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
  update:(p:Record<string,unknown>)=>{op='update';patch=p;return q},insert:(p:Record<string,unknown>)=>{op='insert';patch=p;return q},
  maybeSingle:async()=>{const r=exec();return {data:Array.isArray(r.data)?r.data[0]??null:r.data,error:null}},
  then:(ok:(v:unknown)=>unknown,err?:(e:unknown)=>unknown)=>Promise.resolve(exec()).then(ok,err)})
 return q}}}))
vi.mock('@/lib/ediel/services/authorization',()=>({assertEdielTenantActor:async()=>undefined}))
vi.mock('@/lib/ediel/inbound/receptions',()=>({recordInboundReception:async()=>({first:true}),requireFirstReception:()=>undefined}))
vi.mock('@/lib/ediel/core/dedupe',async(orig)=>({...(await orig<object>()),findInboundDuplicateByCanonicalIdentity:async()=>null}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory',()=>({createInboundMailTask:async()=>'task'}))
import {applySafeInboundStatusUpdate,createInboundEdielMessage,isNegativeAperak,isPositiveAperak} from '@/lib/inbound-mail/inboundStatusUpdater'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {classifyCanonicalInboundAck} from '@/lib/ediel/ack/inboundAckOutcome'

const aperak=(input:{erc?:string[];functionCode?:string;utiltsCode?:string}={})=>parseEdifactPayload(EdifactEnvelopeCodec.encode({
 sender:'7300000000002',receiver:'7300000000001',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'A-1',
 applicationReference:input.utiltsCode?'23-DDQ-E66-METERVALUE':'23-DDQ-PRODAT',acknowledgementRequest:false,environment:'test',createdAt:new Date('2026-10-04T12:00:00Z'),
 messages:[{messageReference:'1',messageTypeToken:input.utiltsCode?'APERAK:D:04A:UN:E5SE5A':'APERAK:D:96A:UN:E2SE6A',businessSegments:[
 input.utiltsCode?`BGM+${input.utiltsCode}+ACK-1+9`:`BGM++ACK-1+${input.functionCode??'34'}`,'DTM+137:202610041200:203','RFF+ACW:DOC-1',
 'NAD+FR+7300000000002:160:SVK','NAD+DO+7300000000001:160:SVK',...(input.erc??['100']).flatMap(code=>[`ERC+${code}::260`,'FTX+AAO+++SYNTHETIC ACK','RFF+Z07:POINT-1','RFF+LI:LI-1']),
 ]}]}))
const ack=(family:'APERAK'|'CONTRL')=>family==='APERAK'?aperak():parseEdifactPayload(EdifactEnvelopeCodec.encode({
 sender:'7300000000002',receiver:'7300000000001',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'A-1',applicationReference:'23-DDQ-PRODAT',
 acknowledgementRequest:false,environment:'test',createdAt:new Date('2026-10-04T12:00:00Z'),messages:[{messageReference:'1',messageTypeToken:'CONTRL:2:2:UN:EDIEL2',businessSegments:['UCI+ORIG-I+7300000000001:14+7300000000002:14+1']}]}))
const input=(parsed=ack('APERAK'))=>({companyId:'company',environment:'test',parsed,actorUserId:'actor',parseResultId:'parse',
 inboundEmailMessageId:'mail',outboundMatch:{status:'matched',entityType:'outbound_request',entityId:'outbound-1',reasons:[],candidates:[{outbound_request_id:'outbound-1',source_type:'supplier_switch_request',source_id:'switch-1'}]} as never,
 meteringPointMatch:{status:'missing',entityId:null,reasons:[],candidates:[]} as never})
const run=(family:'APERAK'|'CONTRL')=>applySafeInboundStatusUpdate(input(ack(family)))

beforeEach(()=>{db.rows={
 outbound_requests:[{id:'outbound-1',company_id:'company',status:'confirmed',response_payload:{z04:'kept'},source_type:'supplier_switch_request',source_id:'switch-1'}],
 supplier_switch_requests:[{id:'switch-1',company_id:'company',status:'accepted'}],
 inbound_email_messages:[{id:'mail',company_id:'company',environment:'test',received_at:'2026-10-04T12:00:00Z'}],
 ediel_messages:[{id:'z03-out',company_id:'company',environment:'test',direction:'outbound',outbound_request_id:'outbound-1',message_code:'Z03',status:'sent'}],
 ediel_message_events:[],inbound_mail_tasks:[]}})

it.each(['APERAK','CONTRL'] as const)('legacy updater: a late positive %s after Z04 keeps the confirmed request and completes the Z03 ACK columns',async family=>{
 await run(family)
 expect(db.rows.outbound_requests[0]).toMatchObject({status:'confirmed',response_payload:{z04:'kept'}})
 expect(db.rows.supplier_switch_requests[0].status).toBe('accepted')
 const z03=db.rows.ediel_messages.find(r=>r.id==='z03-out')!
 expect(z03).toMatchObject({ack_outcome:'positive',failed_at:null})
 expect(family==='APERAK'?z03.aperak_status:z03.contrl_status).toBe('accepted')
})
it('legacy updater: before any business response the positive APERAK still records application acceptance',async()=>{
 db.rows.outbound_requests[0]={...db.rows.outbound_requests[0],status:'sent',response_payload:null}
 await run('APERAK')
 expect(db.rows.outbound_requests[0].status).toBe('application_accepted')
})

it.each([
 {name:'PRODAT ERC100',options:{erc:['100']},outcome:'positive'},
 {name:'PRODAT processed rejection',options:{erc:['9']},outcome:'negative'},
 {name:'PRODAT mixed object results',options:{erc:['100','9']},outcome:'negative'},
 {name:'PRODAT whole rejection',options:{erc:['9'],functionCode:'27'},outcome:'negative'},
 {name:'UTILTS312',options:{utiltsCode:'312'},outcome:'positive'},
 {name:'UTILTS313',options:{utiltsCode:'313'},outcome:'negative'},
 {name:'PRODAT missing ERC',options:{erc:[]},outcome:'invalid'},
 {name:'PRODAT conflicting whole rejection',options:{erc:['100'],functionCode:'27'},outcome:'invalid'},
 {name:'PRODAT invalid function',options:{functionCode:'9'},outcome:'invalid'},
 {name:'UTILTS invalid BGM',options:{utiltsCode:'314'},outcome:'invalid'},
])('actual physical $name projection agrees with canonical outcome',async ({options,outcome})=>{
 const parsed=aperak(options);expect(classifyCanonicalInboundAck(parsed).outcome).toBe(outcome)
 expect(isNegativeAperak(parsed)).toBe(outcome==='negative');expect(isPositiveAperak(parsed)).toBe(outcome==='positive')
 const business=JSON.stringify({requests:db.rows.outbound_requests,switches:db.rows.supplier_switch_requests})
 const id=await createInboundEdielMessage(input(parsed));const original=db.rows.ediel_messages.find(row=>row.id===id)!
 expect(original).toMatchObject({raw_payload:parsed.rawPayload,status:outcome==='positive'?'received':'failed',aperak_status:outcome==='positive'?'accepted':'rejected',functional_check_status:outcome==='positive'?'accepted':'rejected',ack_outcome:outcome==='invalid'?null:outcome})
 expect(original.acknowledged_at===null).toBe(outcome!=='positive')
 if(outcome==='invalid')expect(original.failure_reason).toBe(classifyCanonicalInboundAck(parsed).reason)
 expect(JSON.stringify({requests:db.rows.outbound_requests,switches:db.rows.supplier_switch_requests})).toBe(business)
 expect(db.rows.ediel_message_events.at(-1)).toMatchObject({event_status:outcome==='positive'?'info':'warning'})
})
it.each([
 {erc:[]}, {erc:['100'],functionCode:'27'}, {functionCode:'9'}, {utiltsCode:'314'},
])('invalid physical ACK cannot reach legacy direct acceptance or any persistence/effects %#',async options=>{
 const parsed=aperak(options);expect(classifyCanonicalInboundAck(parsed).outcome).toBe('invalid')
 const before=JSON.stringify(db.rows)
 await expect(applySafeInboundStatusUpdate(input(parsed))).rejects.toThrow('ediel_inbound_aperak_invalid')
 expect(JSON.stringify(db.rows)).toBe(before)
})
