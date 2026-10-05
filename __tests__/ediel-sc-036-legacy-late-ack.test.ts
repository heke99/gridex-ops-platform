// masterplan: SC-036
// Legacy inbound updater: a late positive APERAK or CONTRL after Z04 keeps the
// confirmed request and its Z04 payload, and completes the Z03 ACK columns.
// Declared ports: in-memory Supabase tables, tenant actor, reception and duplicate lookups.
// edielInboundProcessor routes every CONTRL/APERAK to the canonical updater; these
// legacy branches are only reachable by direct callers. The legacy classifier reads
// any ERC as negative, so its positive APERAK fixture carries no ERC segment.
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
import {applySafeInboundStatusUpdate} from '@/lib/inbound-mail/inboundStatusUpdater'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'

const unb="UNA:+.? 'UNB+UNOC:3+7300000000002:14+7300000000001:14+261004:1200+A-1++23-DDQ-PRODAT'"
const ack=(family:'APERAK'|'CONTRL')=>parseEdifactPayload(family==='APERAK'
 ?unb+"UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++34'DTM+137:202610041200:203'RFF+ACW:DOC-1'NAD+FR+7300000000002:160:SVK'NAD+DO+7300000000001:160:SVK'UNT+7+1'UNZ+1+A-1'"
 :unb+"UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ORIG-I+7300000000001:14+7300000000002:14+1'UNT+3+1'UNZ+1+A-1'")
const run=(family:'APERAK'|'CONTRL')=>applySafeInboundStatusUpdate({companyId:'company',environment:'test',parsed:ack(family),actorUserId:'actor',parseResultId:'parse',
 inboundEmailMessageId:'mail',outboundMatch:{status:'matched',entityType:'outbound_request',entityId:'outbound-1',reasons:[],candidates:[{outbound_request_id:'outbound-1',source_type:'supplier_switch_request',source_id:'switch-1'}]} as never,
 meteringPointMatch:{status:'missing',entityId:null,reasons:[],candidates:[]} as never})

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
