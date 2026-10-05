// masterplan: SC-036
// Z04 arrives before the positive APERAK (or CONTRL). The business response
// already advanced the outbound request; the late ACK only completes the ACK
// columns and never rolls the request back to an ACK-stage status.
import {beforeEach,expect,it,vi} from 'vitest'
const db=vi.hoisted(()=>({rows:{} as Record<string,Record<string,unknown>[]>}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 let op:'select'|'update'|'insert'='select',patch:Record<string,unknown>={};const filters:((r:Record<string,unknown>)=>boolean)[]=[]
 const q:Record<string,unknown>={}
 Object.assign(q,{select:()=>q,limit:()=>q,order:()=>q,maybeSingle:()=>q,single:()=>q,is:()=>q,
  eq:(c:string,v:unknown)=>{filters.push(r=>r[c]===v);return q},
  in:(c:string,v:unknown[])=>{filters.push(r=>v.includes(r[c]));return q},
  not:(c:string,o:string,v:string)=>{const list=v.replace(/[()"]/g,'').split(',');filters.push(r=>o!=='in'||!list.includes(String(r[c])));return q},
  update:(p:Record<string,unknown>)=>{op='update';patch=p;return q},
  insert:(p:Record<string,unknown>)=>{op='insert';patch=p;return q},upsert:(p:Record<string,unknown>)=>{op='insert';patch=p;return q},
  then:(resolve:(v:unknown)=>unknown)=>{const rows=db.rows[table]??=[]
   if(op==='update')for(const r of rows)if(filters.every(f=>f(r)))Object.assign(r,patch)
   if(op==='insert')rows.push({id:'inserted-'+rows.length,...patch})
   return Promise.resolve({data:op==='insert'?{id:'inbound-ack'}:null,error:null}).then(resolve)}})
 return q}}}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory',()=>({createInboundMailTask:async()=>'task'}))
import {applyCanonicalInboundAckStatusUpdate} from '@/lib/inbound-mail/canonicalInboundAckStatusUpdater'
import {parseEdifactPayload} from '@/lib/inbound-mail/edielEmailParser'
import {classifyCanonicalInboundAck} from '@/lib/ediel/ack/inboundAckOutcome'

const unb="UNA:+.? 'UNB+UNOC:3+7300000000002:14+7300000000001:14+261004:1200+A-1++23-DDQ-PRODAT'"
const ack=(family:'APERAK'|'CONTRL')=>parseEdifactPayload(family==='APERAK'
 ?unb+"UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++34'DTM+137:202610041200:203'RFF+ACW:DOC-1'NAD+FR+7300000000002:160:SVK'NAD+DO+7300000000001:160:SVK'ERC+100'FTX+AAO++100::260+OK'UNT+9+1'UNZ+1+A-1'"
 :unb+"UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ORIG-I+7300000000001:14+7300000000002:14+1'UNT+3+1'UNZ+1+A-1'")
const matched={status:'matched',entityType:'outbound_request',entityId:'outbound-1',candidates:[{source_type:'supplier_switch_request',source_id:'switch-1'}]} as never
const run=(family:'APERAK'|'CONTRL')=>applyCanonicalInboundAckStatusUpdate({companyId:'company',environment:'test',parsed:ack(family),outboundMatch:matched,
 meteringPointMatch:{status:'unmatched',candidates:[]} as never,inboundEmailMessageId:'mail'})

beforeEach(()=>{db.rows={outbound_requests:[{id:'outbound-1',company_id:'company',status:'confirmed',response_payload:{z04:'kept'}}],
 supplier_switch_requests:[{id:'switch-1',company_id:'company',status:'accepted'}]}})

it('both fixtures are classified as positive ACKs',()=>{for(const f of ['APERAK','CONTRL'] as const)expect(classifyCanonicalInboundAck(ack(f)),JSON.stringify(ack(f))).toMatchObject({outcome:'positive'})})
it.each(['APERAK','CONTRL'] as const)('a late positive %s after Z04 keeps the confirmed business status and Z04 payload',async family=>{
 await run(family)
 expect(db.rows.outbound_requests[0]).toMatchObject({status:'confirmed',response_payload:{z04:'kept'}})
 expect(db.rows.supplier_switch_requests[0].status).toBe('accepted')
})
it('before any business response the positive APERAK still records application acceptance',async()=>{
 db.rows.outbound_requests[0]={id:'outbound-1',company_id:'company',status:'sent',response_payload:null}
 await run('APERAK')
 expect(db.rows.outbound_requests[0].status).toBe('application_accepted')
})
